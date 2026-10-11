import type { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

import type { ChunkVector, Entry, EntryKind, Filter, Ranked, StoreStats, StoredEntry } from '../../core/types'
import { EMBEDDED_KINDS, MIN_EMBEDDED_CHARS } from '../../core/types'
import { acquireWriteLock, openDatabase } from './database'
import type { Params } from './database'
import { StoreMissingError } from './errors'
import { clauseOf } from './filters'
import { lexicalQuery } from './lexical'
import { SCHEMA, SCHEMA_VERSION, TABLES } from './schema'
import { dropQuantized, encodeVector, initVectors, quantizeVectors, scanFunction } from './vectors'
import type { VectorSpace } from './vectors'

export type { VectorSpace }

export type OpenOptions = { readOnly?: boolean }

export type FileState = { size: number; offset: number }

type EntryRow = { id: number; session: string; project: string; kind: EntryKind; ts: number; text: string }

const kindList = (kinds: readonly EntryKind[]): string => kinds.map(k => `'${k}'`).join(', ')

const atLeastOne = (limit: number): number => Math.max(1, Math.trunc(limit))

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
    const insert = this.db.query('insert into entries (source, session, project, kind, ts, text) values ($source, $session, $project, $kind, $ts, $text)')
    return this.db.transaction(() =>
      entries.map(e => Number(insert.run({ source, session: e.session, project: e.project, kind: e.kind, ts: Math.trunc(e.ts), text: e.text }).lastInsertRowid)),
    )()
  }

  // Stores the entries read from a transcript and how far it was read, in one transaction: after a crash the
  // position never runs ahead of the entries, and no line is stored twice.
  ingest(path: string, entries: readonly Entry[], state: FileState): number[] {
    this.assertWritable()
    return this.db.transaction(() => {
      const ids = this.addEntries(entries, path)
      this.setFileState(path, state)
      return ids
    })()
  }

  entries(ids: readonly number[]): StoredEntry[] {
    if (ids.length === 0) return []
    const wanted = ids.map(id => Math.trunc(id)).join(', ')
    const rows = this.all<EntryRow>(`select id, session, project, kind, ts, text from entries where id in (${wanted})`)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.flatMap(id => byId.get(id) ?? [])
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
  private dropWhere(column: 'session' | 'source', value: string): void {
    this.assertWritable()
    this.run(`delete from entries where ${column} = $value`, { value })
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
      where kind in (${kindList(EMBEDDED_KINDS)}) and length(text) >= ${MIN_EMBEDDED_CHARS}
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

  lexical(terms: readonly string[], limit: number, filter: Filter): Ranked[] {
    const query = lexicalQuery(terms, limit, filter)
    return query === null ? [] : this.all<Ranked>(query.sql, query.params)
  }

  // The entries whose nearest passage is within `maxDistance` (cosine distance, 0 to 2) of the vector, nearest
  // first, with a score of one minus the distance.
  semantic(vector: readonly number[], limit: number, filter: Filter, maxDistance = 0.6): Ranked[] {
    if (this.space === null || this.space.dimension !== vector.length) return []
    const where = clauseOf(filter, 'e')
    const rows = this.all<{ id: number; dist: number }>(
      `select c.entry as id, min(v.distance) as dist
       from ${scanFunction(this.isCompact)} v
         join chunks c on c.id = v.rowid
         join entries e on e.id = c.entry
       where v.distance <= $max and ${where.sql}
       group by c.entry
       order by dist, c.entry desc
       limit ${atLeastOne(limit)}`,
      { ...where.params, query: encodeVector(vector), max: maxDistance },
    )
    return rows.map(r => ({ id: r.id, score: 1 - r.dist }))
  }

  stats(): StoreStats {
    const totals = this.one<{ entries: number; sessions: number }>('select count(*) as entries, count(distinct session) as sessions from entries')
    const kinds = this.all<{ kind: EntryKind; n: number }>('select kind, count(*) as n from entries group by kind order by kind')
    return {
      entries: totals?.entries ?? 0,
      sessions: totals?.sessions ?? 0,
      chunks: this.one<{ n: number }>('select count(*) as n from chunks')?.n ?? 0,
      byKind: Object.fromEntries(kinds.map(r => [r.kind, r.n])),
      model: this.space?.model ?? null,
      dimension: this.space?.dimension ?? null,
    }
  }

  private assertWritable(): void {
    if (this.readOnly) throw new Error('the index was opened read-only')
  }
}
