import type { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

import { REDACTED_MARK } from '../../core/text/redact'
import type { ChunkVector, CommandUse, Entry, EntryKind, FileUse, Filter, ForgottenSession, Ranked, SessionSummary, StoreStats, StoredEntry, Touch, Turn } from '../../core/types'
import { MIN_EMBEDDED_CHARS } from '../../core/types'
import { commandQuery } from './commands'
import { acquireWriteLock, openDatabase } from './database'
import type { Params } from './database'
import { StoreMissingError } from './errors'
import { clauseOf } from './filters'
import { lexicalQuery, matchExpression } from './lexical'
import { SCHEMA, SCHEMA_VERSION, TABLES } from './schema'
import { dropQuantized, encodeVector, initVectors, quantizeVectors, scanFunction } from './vectors'
import type { VectorSpace } from './vectors'

export type { VectorSpace }

export type OpenOptions = { readOnly?: boolean }

export type FileState = { size: number; offset: number }

export type PageOptions = { limit: number; offset: number; kinds?: readonly EntryKind[] }

const ENTRY_COLUMNS = 'id, session, parent, project, kind, ts, text'
const ENTRY_COLUMNS_OF_E = 'e.id, e.session, e.parent, e.project, e.kind, e.ts, e.text'

type EntryRow = { id: number; session: string; parent: string; project: string; kind: EntryKind; ts: number; text: string }

// A row as the rest of the code holds it: `parent` is there only for a sub-agent.
const withParent = <T extends { parent: string }>(row: T): Omit<T, 'parent'> & { parent?: string } => {
  const { parent, ...rest } = row
  return parent === '' ? rest : { ...rest, parent }
}

const kindList = (kinds: readonly EntryKind[]): string => kinds.map(k => `'${k}'`).join(', ')

const atLeastOne = (limit: number): number => Math.max(1, Math.trunc(limit))

const FILE_USE = `path, session, min(parent) as parent, min(project) as project,
  sum(action = 'edit') as edits, sum(action = 'read') as reads,
  coalesce(min(case when action = 'edit' then ts end), min(ts)) as first, max(ts) as last`

// The index: sessions' entries, a full-text index over them and their vectors, in one SQLite file. One
// process writes at a time; any number read, also while it writes.
export class Store {
  private space: VectorSpace | null = null

  private constructor(
    private db: Database,
    private readonly lock: Database | null,
    readonly path: string,
    readonly readOnly: boolean,
  ) {}

  // Throws StoreMissingError when a reader finds no usable index, and StoreBusyError when a writer finds
  // another writer at work.
  static open(path: string, options: OpenOptions = {}): Store {
    const readOnly = options.readOnly === true
    if (readOnly && !existsSync(path)) throw new StoreMissingError(path)
    const lock = readOnly ? null : acquireWriteLock(path)
    let db: Database | null = null
    try {
      db = openDatabase(path, readOnly)
      const store = new Store(db, lock, path, readOnly)
      store.load()
      return store
    } catch (error) {
      db?.close()
      lock?.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
    this.lock?.close()
  }

  private all<T>(sql: string, params: Params = {}): T[] {
    return this.db.query(sql).all(params) as T[]
  }

  private one<T>(sql: string, params: Params = {}): T | null {
    return this.db.query(sql).get(params) as T | null
  }

  private run(sql: string, params: Params = {}): void {
    this.db.query(sql).run(params)
  }

  private load(): void {
    const current = this.schemaVersion() === SCHEMA_VERSION
    if (this.readOnly && !current) throw new StoreMissingError(this.path)
    if (!this.readOnly) {
      if (!current) for (const table of TABLES) this.db.exec(`drop table if exists ${table}`)
      this.db.exec(SCHEMA)
      this.setMeta('schema', SCHEMA_VERSION)
    }
    const model = this.meta('model')
    const dimension = Number(this.meta('dimension'))
    if (model !== null && dimension > 0) {
      this.space = { model, dimension }
      initVectors(this.db, dimension)
    }
  }

  // The version the file was written under, or null for a file with no index in it.
  private schemaVersion(): string | null {
    const hasMeta = this.one("select 1 from sqlite_master where type = 'table' and name = 'meta'") !== null
    return hasMeta ? this.meta('schema') : null
  }

  private meta(key: string): string | null {
    return this.one<{ value: string }>('select value from meta where key = $key', { key })?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.run('insert or replace into meta (key, value) values ($key, $value)', { key, value })
  }

  fileState(path: string): FileState | null {
    return this.one<FileState>('select size, offset from files where path = $path', { path })
  }

  setFileState(path: string, state: FileState): void {
    this.run('insert or replace into files (path, size, offset) values ($path, $size, $offset)', {
      path,
      size: Math.trunc(state.size),
      offset: Math.trunc(state.offset),
    })
  }

  // `source` is the transcript the entries came from; the tests that need none leave it empty.
  addEntries(entries: readonly Entry[], source = ''): number[] {
    this.assertWritable()
    const insert = this.db.query('insert into entries (source, session, parent, project, kind, ts, text) values ($source, $session, $parent, $project, $kind, $ts, $text)')
    return this.db.transaction(() =>
      entries.map(e =>
        Number(insert.run({ source, session: e.session, parent: e.parent ?? '', project: e.project, kind: e.kind, ts: Math.trunc(e.ts), text: e.text }).lastInsertRowid),
      ),
    )()
  }

  // Stores the entries read from a transcript and how far it was read, in one transaction: after a crash the
  // position never runs ahead of the entries, and no line is stored twice. What belongs to a forgotten session
  // is left out.
  ingest(path: string, entries: readonly Entry[], state: FileState, touches: readonly Touch[] = []): number[] {
    this.assertWritable()
    const kept = this.keeper()
    return this.db.transaction(() => {
      const ids = this.addEntries(entries.filter(kept), path)
      this.addTouches(touches.filter(kept), path)
      this.setFileState(path, state)
      return ids
    })()
  }

  addTouches(touches: readonly Touch[], source = ''): void {
    this.assertWritable()
    const insert = this.db.query(
      'insert into touches (source, session, parent, project, ts, path, action, tool) values ($source, $session, $parent, $project, $ts, $path, $action, $tool)',
    )
    this.db.transaction(() => {
      for (const t of touches) insert.run({ source, session: t.session, parent: t.parent ?? '', project: t.project, ts: Math.trunc(t.ts), path: t.path, action: t.action, tool: t.tool })
    })()
  }

  private keeper(): (record: { session: string; parent?: string }) => boolean {
    const gone = new Set(this.forgotten().map(f => f.session))
    return record => !gone.has(record.session) && !(record.parent !== undefined && gone.has(record.parent))
  }

  // Puts these in place of what was recorded about files from one transcript: the files its tool calls named,
  // and the edit entries. Its other entries and their vectors stay.
  replaceFileRecords(source: string, touches: readonly Touch[], edits: readonly Entry[]): void {
    this.assertWritable()
    const kept = this.keeper()
    this.db.transaction(() => {
      this.run('delete from touches where source = $source', { source })
      this.run("delete from entries where source = $source and kind = 'edit'", { source })
      this.addTouches(touches.filter(kept), source)
      this.addEntries(edits.filter(kept), source)
    })()
  }

  // The setting the recorded files were read under, or null when none were read yet.
  get fileTools(): string | null {
    return this.meta('fileTools')
  }

  set fileTools(setting: string) {
    this.assertWritable()
    this.setMeta('fileTools', setting)
  }

  // What each session did to the files whose path is `suffix` or ends with it at a folder boundary, the
  // latest session first. Sessions that only read are left out unless `reads` is set.
  fileUses(suffix: string, options: { reads?: boolean; limit: number }): FileUse[] {
    const tail = `/${suffix.replace(/^\/+/, '')}`
    return this.all<FileUse & { parent: string }>(
      `select ${FILE_USE} from touches
       where path = $suffix or substr(path, -length($tail)) = $tail
       group by path, session ${options.reads === true ? '' : 'having edits > 0'}
       order by last desc, path limit ${atLeastOne(options.limit)}`,
      { suffix, tail },
    ).map(withParent)
  }

  // The files one session touched, the most changed first.
  sessionFiles(session: string, limit: number): FileUse[] {
    return this.all<FileUse & { parent: string }>(`select ${FILE_USE} from touches where session = $session group by path order by edits desc, reads desc, path limit ${atLeastOne(limit)}`, {
      session,
    }).map(withParent)
  }

  // What the user last typed in a session at or before a time, or first typed in it when nothing came before.
  askedBefore(session: string, ts: number): string | null {
    const params = { session, ts: Math.trunc(ts) }
    const before = this.one<{ text: string }>("select text from entries where session = $session and kind = 'user' and ts <= $ts order by ts desc, id desc limit 1", params)
    const found = before ?? this.one<{ text: string }>("select text from entries where session = $session and kind = 'user' and ts > $ts order by ts, id limit 1", params)
    return found?.text ?? null
  }

  // The turn an entry is in: the prompt that opened it, the last thing Claude said in it after the entry, and
  // the prompt that came next. A prompt opens its own turn. `start` is the id of the opening prompt, or of
  // the entry when the session holds no prompt before it.
  turnOf(id: number): Turn {
    const at = { id: Math.trunc(id) }
    const near = (side: '<' | '>', kind: EntryKind, order: 'asc' | 'desc', rest = ''): string =>
      `select e.id, e.ts, e.text from entries e join entries o on o.id = $id
       where e.session = o.session and e.kind = '${kind}' and (e.ts ${side} o.ts or (e.ts = o.ts and e.id ${side} o.id)) ${rest}
       order by e.ts ${order}, e.id ${order} limit 1`
    type Near = { id: number; ts: number; text: string }
    const self = this.one<{ kind: EntryKind }>('select kind from entries where id = $id', at)
    const opener = self?.kind === 'user' ? null : this.one<Near>(near('<', 'user', 'desc'), at)
    const reply = this.one<Near>(near('>', 'user', 'asc'), at)
    const untilReply = reply === null ? '' : 'and (e.ts < $ts or (e.ts = $ts and e.id < $next))'
    const last = this.one<Near>(near('>', 'assistant', 'desc', untilReply), reply === null ? at : { ...at, ts: reply.ts, next: reply.id })
    const turn: Turn = { start: opener?.id ?? at.id }
    if (opener !== null) turn.asked = opener.text
    if (last !== null) turn.ended = last.text
    if (reply !== null) turn.reply = reply.text
    return turn
  }

  // How many entries a session holds, of the kinds given or of every kind.
  sessionCount(session: string, kinds?: readonly EntryKind[]): number {
    const only = kinds === undefined || kinds.length === 0 ? '' : `and kind in (${kindList(kinds)})`
    return this.one<{ n: number }>(`select count(*) as n from entries where session = $session ${only}`, { session })?.n ?? 0
  }

  entries(ids: readonly number[]): StoredEntry[] {
    if (ids.length === 0) return []
    const wanted = ids.map(id => Math.trunc(id)).join(', ')
    const rows = this.all<EntryRow>(`select ${ENTRY_COLUMNS} from entries where id in (${wanted})`)
    const byId = new Map(rows.map(r => [r.id, withParent(r)]))
    return ids.flatMap(id => byId.get(id) ?? [])
  }

  // The sessions whose id starts with the prefix, the latest first.
  sessions(prefix: string, limit = 20): SessionSummary[] {
    return this.all<SessionSummary & { parent: string }>(
      `select session, min(parent) as parent, min(project) as project, min(ts) as first, max(ts) as last, count(*) as entries
       from entries where substr(session, 1, length($prefix)) = $prefix
       group by session order by last desc, session limit ${atLeastOne(limit)}`,
      { prefix },
    ).map(withParent)
  }

  // One page of a session's entries, oldest first.
  sessionEntries(session: string, page: PageOptions): StoredEntry[] {
    const kinds = page.kinds === undefined || page.kinds.length === 0 ? '' : `and kind in (${kindList(page.kinds)})`
    return this.all<EntryRow>(
      `select ${ENTRY_COLUMNS} from entries where session = $session ${kinds}
       order by ts, id limit ${atLeastOne(page.limit)} offset ${Math.max(0, Math.trunc(page.offset))}`,
      { session },
    ).map(withParent)
  }

  // The entries of the given kinds that come after an entry in its session, nearest first.
  followers(id: number, kinds: readonly EntryKind[], limit: number): StoredEntry[] {
    return this.all<EntryRow>(
      `select ${ENTRY_COLUMNS_OF_E} from entries e join entries o on o.id = $id
       where e.session = o.session and e.kind in (${kindList(kinds)}) and (e.ts > o.ts or (e.ts = o.ts and e.id > o.id))
       order by e.ts, e.id limit ${atLeastOne(limit)}`,
      { id: Math.trunc(id) },
    ).map(withParent)
  }

  commands(terms: readonly string[], limit: number, filter: Filter): CommandUse[] {
    const query = commandQuery(terms, limit, filter)
    return query === null ? [] : this.all<CommandUse>(query.sql, query.params)
  }

  // Removes a session and the sub-agents it started from the index and records it, so that an index run does
  // not bring them back. Returns the number of entries removed; a session with none is not recorded.
  forget(session: string, at: number): number {
    this.assertWritable()
    const found = this.one<{ project: string | null; n: number }>('select min(case when session = $session then project end) as project, count(*) as n from entries where session = $session or parent = $session', {
      session,
    })
    if (found === null || found.n === 0) return 0
    const sources = this.all<{ source: string }>("select distinct source from entries where (session = $session or parent = $session) and source <> ''", { session })
    this.db.transaction(() => {
      this.run('insert or replace into forgotten (session, project, at, sources) values ($session, $project, $at, $sources)', {
        session,
        project: found.project ?? '',
        at: Math.trunc(at),
        sources: JSON.stringify(sources.map(s => s.source)),
      })
      this.dropWhere('session', session)
      this.dropWhere('parent', session)
    })()
    return found.n
  }

  forgotten(): ForgottenSession[] {
    return this.all('select session, project, at from forgotten order by at desc, session')
  }

  // Takes a session off the forgotten list and drops what was read from its transcripts, so the next index
  // run reads them again from the start. Its transcripts are the ones it had entries in when it was forgotten
  // and the ones its id names: <session>.jsonl and <session>/subagents/*, which may have been read, with
  // every row left out, while it was forgotten. False when the session is not on the list.
  unforget(session: string): boolean {
    this.assertWritable()
    const row = this.one<{ sources: string }>('select sources from forgotten where session = $session', { session })
    if (row === null) return false
    this.db.transaction(() => {
      this.run('delete from forgotten where session = $session', { session })
      const named = this.all<{ path: string }>("select path from files where instr(path, '/' || $session || '.jsonl') > 0 or instr(path, '/' || $session || '/') > 0", { session })
      for (const source of new Set([...(JSON.parse(row.sources) as string[]), ...named.map(f => f.path)])) this.dropSource(source)
    })()
    return true
  }

  dropSession(session: string): void {
    this.dropWhere('session', session)
  }

  // Forgets everything read from a transcript, and how far it was read.
  dropSource(path: string): void {
    this.db.transaction(() => {
      this.dropWhere('source', path)
      this.run('delete from files where path = $path', { path })
    })()
  }

  // The vectors of the entries go with them: the chunks table cascades.
  private dropWhere(column: 'session' | 'parent' | 'source', value: string): void {
    this.assertWritable()
    this.db.transaction(() => {
      this.run(`delete from entries where ${column} = $value`, { value })
      this.run(`delete from touches where ${column} = $value`, { value })
    })()
  }

  // Declares the model whose vectors the index holds. A different model or length empties the vectors.
  useVectors(space: VectorSpace): void {
    this.assertWritable()
    if (this.space?.model === space.model && this.space.dimension === space.dimension) return
    const hadVectors = this.space !== null
    this.db.transaction(() => {
      this.run('delete from chunks')
      this.setMeta('model', space.model)
      this.setMeta('dimension', String(space.dimension))
      this.setMeta('compact', '0')
    })()
    if (hadVectors) {
      dropQuantized(this.db)
      this.reconnect()
    }
    initVectors(this.db, space.dimension)
    this.space = space
  }

  // The extension fixes a column's vector length for the life of a connection, so a new length needs a new one.
  private reconnect(): void {
    this.db.close()
    this.db = openDatabase(this.path, this.readOnly)
  }

  get vectors(): VectorSpace | null {
    return this.space
  }

  private get awaiting(): string {
    return `from entries e
      where length(text) >= ${MIN_EMBEDDED_CHARS}
        and not exists (select 1 from chunks c where c.entry = e.id)`
  }

  // Entries that should have a vector and do not yet, oldest first.
  pending(limit: number): { id: number; text: string }[] {
    return this.all(`select id, text ${this.awaiting} order by id limit ${atLeastOne(limit)}`)
  }

  countPending(): number {
    return this.one<{ n: number }>(`select count(*) as n ${this.awaiting}`)?.n ?? 0
  }

  addChunks(chunks: readonly ChunkVector[]): void {
    this.assertWritable()
    const space = this.space
    if (space === null) throw new Error('useVectors must be called before addChunks')
    const insert = this.db.query('insert into chunks (entry, seq, embedding) values ($entry, $seq, $embedding)')
    this.db.transaction(() => {
      for (const c of chunks) {
        if (c.vector.length !== space.dimension) throw new Error(`a vector has ${c.vector.length} values; the index holds ${space.dimension}`)
        insert.run({ entry: c.entry, seq: c.seq, embedding: encodeVector(c.vector) })
      }
      this.setMeta('compact', '0')
    })()
  }

  // Builds the compact copy of the vectors that searches scan, when vectors were stored since it was last
  // built. Until then searches scan the vectors themselves, which is exact and slower.
  compactVectors(): void {
    this.assertWritable()
    if (this.space === null || this.isCompact) return
    const { n } = this.one<{ n: number }>('select count(*) as n from chunks') ?? { n: 0 }
    if (n === 0) return
    quantizeVectors(this.db)
    this.setMeta('compact', '1')
  }

  private get isCompact(): boolean {
    return this.meta('compact') === '1'
  }

  // How many entries of a kind hold each term, and how many entries of that kind there are.
  termCounts(terms: readonly string[], kind: EntryKind): { total: number; counts: number[] } {
    const count = (match: string | null): number =>
      match === null
        ? 0
        : (this.one<{ n: number }>('select count(*) as n from entries_fts join entries e on e.id = entries_fts.rowid where entries_fts match $match and e.kind = $kind', { match, kind })?.n ?? 0)
    const total = this.one<{ n: number }>('select count(*) as n from entries where kind = $kind', { kind })?.n ?? 0
    return { total, counts: terms.map(t => count(matchExpression([t]))) }
  }

  lexical(terms: readonly string[], limit: number, filter: Filter): Ranked[] {
    const query = lexicalQuery(terms, limit, filter)
    return query === null ? [] : this.all<Ranked>(query.sql, query.params)
  }

  // The entries whose nearest passage is within `maxDistance` (cosine distance, 0 to 2) of the vector, nearest
  // first, with a score of one minus the distance. The kinds in `apart` are ranked apart from the rest, and
  // each side gives up to `limit` entries, from one scan of the vectors.
  semantic(vector: readonly number[], limit: number, filter: Filter, maxDistance = 0.6, apart: readonly EntryKind[] = []): Ranked[] {
    if (this.space === null || this.space.dimension !== vector.length) return []
    const where = clauseOf(filter, 'e')
    const side = apart.length === 0 ? '0' : `e.kind in (${kindList(apart)})`
    const rows = this.all<{ id: number; dist: number }>(
      `select id, dist from (
         select c.entry as id, min(v.distance) as dist,
           row_number() over (partition by ${side} order by min(v.distance), c.entry desc) as place
         from ${scanFunction(this.isCompact)} v
           join chunks c on c.id = v.rowid
           join entries e on e.id = c.entry
         where v.distance <= $max and ${where.sql}
         group by c.entry)
       where place <= ${atLeastOne(limit)}
       order by dist, id desc`,
      { ...where.params, query: encodeVector(vector), max: maxDistance },
    )
    return rows.map(r => ({ id: r.id, score: 1 - r.dist }))
  }

  stats(): StoreStats {
    const totals = this.one<{ entries: number; sessions: number; agents: number }>(
      "select count(*) as entries, count(distinct case when parent = '' then session end) as sessions, count(distinct case when parent <> '' then session end) as agents from entries",
    )
    const kinds = this.all<{ kind: EntryKind; n: number }>('select kind, count(*) as n from entries group by kind order by kind')
    return {
      entries: totals?.entries ?? 0,
      sessions: totals?.sessions ?? 0,
      agents: totals?.agents ?? 0,
      chunks: this.one<{ n: number }>('select count(*) as n from chunks')?.n ?? 0,
      files: this.one<{ n: number }>('select count(distinct path) as n from touches')?.n ?? 0,
      redacted: this.one<{ n: number }>('select count(*) as n from entries where instr(text, $mark) > 0', { mark: REDACTED_MARK })?.n ?? 0,
      byKind: Object.fromEntries(kinds.map(r => [r.kind, r.n])),
      model: this.space?.model ?? null,
      dimension: this.space?.dimension ?? null,
    }
  }

  private assertWritable(): void {
    if (this.readOnly) throw new Error('the index was opened read-only')
  }
}
