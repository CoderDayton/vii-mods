import { getExtensionPath } from '@sqliteai/sqlite-vector'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Entry } from '../../src/core/transcript/entries'
import type { Filter } from '../../src/core/types'
import { StoreBusyError, StoreMissingError } from '../../src/runtime/store/errors'
import { Store } from '../../src/runtime/store/store'

let dir = ''
let path = ''
let store: Store

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({
  kind: 'user',
  text,
  ts: Date.parse('2026-10-01T00:00:00Z'),
  session: 's1',
  project: '/work/app',
  ...extra,
})

const textsOf = (ids: readonly { id: number }[]): string[] => store.entries(ids.map(h => h.id)).map(e => e.text)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookback-store-'))
  path = join(dir, 'index.sqlite')
  store = Store.open(path)
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a word held by more than the common share is counted only until it is past that share', () => {
  store.addEntries([...Array.from({ length: 20 }, (_, i) => entry(`common filler ${i}`)), entry('rare gasket'), entry('rare gasket again')])
  expect(store.termCounts(['common', 'gasket', 'absent'], 'user')).toEqual({ total: 22, counts: [20, 2, 0] })
  expect(store.termCounts(['common', 'gasket', 'absent'], 'user', 0.2)).toEqual({ total: 22, counts: [5, 2, 0] })
})

test('entries come back by id, in the order asked', () => {
  const ids = store.addEntries([entry('first'), entry('second', { kind: 'assistant' })])
  expect(ids).toHaveLength(2)
  const got = store.entries([ids[1]!, ids[0]!])
  expect(got.map(e => e.text)).toEqual(['second', 'first'])
  expect(got[0]).toMatchObject({ kind: 'assistant', session: 's1', project: '/work/app' })
})

test('ids keep counting up after the store is reopened', () => {
  const [a] = store.addEntries([entry('one')])
  store.close()
  store = Store.open(path)
  const [b] = store.addEntries([entry('two')])
  expect(b).toBeGreaterThan(a!)
})

test('the read position of a file is kept', () => {
  expect(store.fileState('/t/a.jsonl')).toBeNull()
  store.setFileState('/t/a.jsonl', { size: 100, offset: 80 })
  store.setFileState('/t/a.jsonl', { size: 150, offset: 150 })
  expect(store.fileState('/t/a.jsonl')).toEqual({ size: 150, offset: 150 })
})

test('an ingest stores the entries and the file position together, or neither', () => {
  const ids = store.ingest('/t/a.jsonl', [entry('one'), entry('two')], { size: 20, offset: 20 })
  expect(ids).toHaveLength(2)
  expect(store.fileState('/t/a.jsonl')).toEqual({ size: 20, offset: 20 })

  const bad = { ...entry('three'), text: undefined as unknown as string }
  expect(() => store.ingest('/t/a.jsonl', [entry('ok'), bad], { size: 40, offset: 40 })).toThrow()
  expect(store.fileState('/t/a.jsonl')).toEqual({ size: 20, offset: 20 })
  expect((store.stats()).entries).toBe(2)
})

test('a keyword search ranks the rarer and the more numerous matches first', () => {
  store.addEntries([
    entry('the build is slow today'),
    entry('ModuleNotFoundError raised by the build'),
    entry('build build build build'),
    entry('nothing relevant here'),
  ])
  const hits = store.lexical(['modulenotfounderror', 'build'], 10, {})
  const texts = textsOf(hits)
  expect(texts[0]).toBe('ModuleNotFoundError raised by the build')
  expect(texts).not.toContain('nothing relevant here')
  expect(hits.every((h, i) => i === 0 || hits[i - 1]!.score >= h.score)).toBe(true)
})

test('a keyword matches the start of a longer word and ignores case', () => {
  store.addEntries([entry('Fixed the CachedResolver bug')])
  expect(store.lexical(['cache'], 5, {})).toHaveLength(1)
  expect(store.lexical([], 5, {})).toEqual([])
})

test('a keyword matches the other forms of its word', () => {
  store.addEntries([entry('We fixed the parser yesterday'), entry('Nothing about it here')])
  expect(textsOf(store.lexical(['fixing'], 5, {}))).toEqual(['We fixed the parser yesterday'])
})

test('a path or a dotted name matches as a whole', () => {
  store.addEntries([entry('edit src/auth_middleware.ts now'), entry('the auth service and some middleware')])
  expect(textsOf(store.lexical(['auth_middleware.ts'], 5, {}))).toEqual(['edit src/auth_middleware.ts now'])
})

test('a keyword that holds query syntax is taken literally', () => {
  store.addEntries([entry('say "hello" to the world')])
  for (const term of ['"hello"', 'hello"', 'NEAR(', 'world)', '*', 'a AND', '%', 'col:hello', '-world']) {
    expect(() => store.lexical([term], 5, {})).not.toThrow()
  }
  expect(store.lexical(['"hello"'], 5, {})).toHaveLength(1)
  expect(store.lexical(['%'], 5, {})).toEqual([])
})

test('entries that were removed no longer match a keyword', () => {
  store.addEntries([entry('deploy notes', { session: 'gone' }), entry('deploy plans', { session: 'kept' })])
  store.dropSession('gone')
  expect(textsOf(store.lexical(['deploy'], 5, {}))).toEqual(['deploy plans'])
})

test('filters narrow a search by project, kind, age and session', () => {
  store.addEntries([
    entry('deploy notes', { project: '/work/app', session: 'a', ts: 2_000 }),
    entry('deploy notes', { project: '/work/api', session: 'b', ts: 1_000, kind: 'assistant' }),
    entry('deploy notes', { project: '/work/api', session: 'c', ts: 3_000 }),
  ])
  const sessions = (filter: Filter): string[] => {
    const hits = store.lexical(['deploy'], 10, filter)
    return store
      .entries(hits.map(h => h.id))
      .map(e => e.session)
      .sort()
  }
  expect(sessions({})).toEqual(['a', 'b', 'c'])
  expect(sessions({ project: 'api' })).toEqual(['b', 'c'])
  expect(sessions({ kinds: ['assistant'] })).toEqual(['b'])
  expect(sessions({ since: 1_500 })).toEqual(['a', 'c'])
  expect(sessions({ excludeSession: 'a' })).toEqual(['b', 'c'])
})

test('a filter can stop at a time, and can let a session in only up to a time', () => {
  store.addEntries([
    entry('deploy notes', { session: 'a', ts: 1_000 }),
    entry('deploy notes', { session: 'a', ts: 3_000 }),
    entry('deploy notes', { session: 'kid', parent: 'a', ts: 3_500 }),
    entry('deploy notes', { session: 'b', ts: 4_000 }),
  ])
  const found = (filter: Filter): string[] =>
    store
      .entries(store.lexical(['deploy'], 10, filter).map(h => h.id))
      .map(e => `${e.session}@${e.ts}`)
      .sort()
  expect(found({ until: 3_000 })).toEqual(['a@1000'])
  expect(found({ sessionBefore: { session: 'a', ts: 2_000 } })).toEqual(['a@1000', 'b@4000'])
})

test('the last thing said in a session before a time is found by kind, passing over one text', () => {
  store.addEntries([
    entry('first prompt', { ts: 1_000 }),
    entry('first answer', { ts: 2_000, kind: 'assistant' }),
    entry('second prompt', { ts: 3_000 }),
    entry('late answer', { ts: 9_000, kind: 'assistant' }),
    entry('another session', { ts: 3_500, session: 's2' }),
  ])
  expect(store.lastSaid('s1', 'user', 5_000)).toEqual({ text: 'second prompt', ts: 3_000 })
  expect(store.lastSaid('s1', 'user', 5_000, ' second prompt\n')?.text).toBe('first prompt')
  expect(store.lastSaid('s1', 'assistant', 5_000)?.text).toBe('first answer')
  expect(store.lastSaid('s1', 'assistant', 1_500)).toBeNull()
})

test('a project filter that holds a wildcard character is taken literally', () => {
  store.addEntries([entry('deploy', { project: '/work/my_app' }), entry('deploy', { project: '/work/myXapp' })])
  expect(store.lexical(['deploy'], 10, { project: 'my_app' })).toHaveLength(1)
})

test('an entry of any kind waits for a vector when it is long enough to mean something', () => {
  store.addEntries([
    entry('yes'),
    entry('a question about the deploy pipeline'),
    entry('git status --short --branch', { kind: 'cmd' }),
    entry('/work/app/src/a.ts\n- const a = 1\n+ const a = 2', { kind: 'edit' }),
    entry('the cache may be stale after a deploy', { kind: 'thinking' }),
    entry('EACCES: permission denied, open the file', { kind: 'error' }),
  ])
  expect(store.pending(10).map(p => p.text.slice(0, 12)).sort()).toEqual(['/work/app/sr', 'EACCES: perm', 'a question a', 'git status -', 'the cache ma'])
})

test('a vector search returns the nearest entry first, once per entry', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const [a, b, c] = store.addEntries([entry('alpha'), entry('beta'), entry('gamma')])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0, 0] },
    { entry: a!, seq: 1, vector: [0.9, 0.1, 0] },
    { entry: b!, seq: 0, vector: [0.6, 0.8, 0] },
    { entry: c!, seq: 0, vector: [0, 0, 1] },
  ])
  const hits = store.semantic([1, 0.05, 0], 10, {}, 2)
  expect(hits.map(h => h.id)).toEqual([a!, b!, c!])
  expect(hits[0]!.score).toBeGreaterThan(0.9)
})

test('a vector search drops entries beyond the distance cut-off', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [near, far] = store.addEntries([entry('near'), entry('far')])
  store.addChunks([
    { entry: near!, seq: 0, vector: [1, 0] },
    { entry: far!, seq: 0, vector: [0, 1] },
  ])
  expect((store.semantic([1, 0], 10, {}, 0.5)).map(h => h.id)).toEqual([near!])
})

test('a vector is stored as one signed byte per value, its largest value scaled to 127', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const [a] = store.addEntries([entry('alpha')])
  store.addChunks([{ entry: a!, seq: 0, vector: [0.5, -0.2, 0] }])
  const raw = new Database(path, { readonly: true })
  const { embedding } = raw.query('select embedding from chunks').get() as { embedding: Uint8Array }
  raw.close()
  expect([...new Int8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength)]).toEqual([127, -51, 0])
})

test('a vector search finds a vector as soon as it is stored, and never one whose entry was removed', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const [a, b, c] = store.addEntries([entry('alpha'), entry('beta', { session: 'gone' }), entry('gamma')])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0, 0] },
    { entry: b!, seq: 0, vector: [0, 1, 0] },
  ])
  const query = [0.1, 0.1, 1]
  const nearest = (): number[] => store.semantic(query, 10, {}, 2).map(h => h.id)
  expect(nearest()).not.toContain(c!)
  store.addChunks([{ entry: c!, seq: 0, vector: [0, 0, 1] }])
  expect(nearest()[0]).toBe(c!)
  store.dropSession('gone')
  expect(nearest()).toEqual([c!, a!])
})

test('a vector search gives the same entries when the nearest passages settle it as when every passage is read', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const kinds = ['user', 'assistant', 'cmd', 'edit', 'result', 'call', 'thinking'] as const
  const ids = store.addEntries(Array.from({ length: 40 }, (_, i) => entry(`entry ${i}`, { kind: kinds[i % kinds.length], session: `s${i % 5}`, project: i % 4 === 0 ? '/work/rare' : '/work/app' })))
  store.addChunks(ids.flatMap((id, i) => [
    { entry: id, seq: 0, vector: [1, Math.sin(i), Math.cos(i * 1.7)] },
    ...(i % 3 === 0 ? [{ entry: id, seq: 1, vector: [Math.cos(i), 1, Math.sin(i * 0.3)] }] : []),
  ]))
  store.close()
  const whole = Store.open(path, { readOnly: true })
  const few = Store.open(path, { readOnly: true, nearestFirst: 4 })
  const query = [1, 0.3, -0.2]
  const cases: [number, Filter, (readonly ('cmd' | 'edit' | 'call' | 'result')[])[]][] = [
    [3, {}, []],
    [2, {}, [['cmd', 'edit'], ['call', 'result']]],
    [3, { kinds: ['edit'] }, []],
    [2, { project: 'rare' }, [['cmd', 'edit']]],
    [5, { excludeSession: 's1', since: 0 }, [['call', 'result']]],
  ]
  for (const [limit, filter, apart] of cases) {
    const all = whole.semantic(query, limit, filter, 2, apart)
    expect(all.length).toBeGreaterThan(0)
    expect(few.semantic(query, limit, filter, 2, apart)).toEqual(all)
  }
  whole.close()
  few.close()
  store = Store.open(path)
})

test('a vector search honours the filters', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [a, b] = store.addEntries([entry('one', { session: 'a' }), entry('two', { session: 'b', kind: 'assistant' })])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0] },
    { entry: b!, seq: 0, vector: [1, 0.1] },
  ])
  expect(store.semantic([1, 0], 10, { kinds: ['assistant'] }).map(h => h.id)).toEqual([b!])
  expect(store.semantic([1, 0], 10, { excludeSession: 'a' }).map(h => h.id)).toEqual([b!])
})

test('a vector search can rank groups of kinds apart, each side up to the limit, in one list', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const ids = store.addEntries([
    entry('cmd one', { kind: 'cmd' }),
    entry('cmd two', { kind: 'cmd' }),
    entry('edit three', { kind: 'edit' }),
    entry('said four'),
    entry('said five', { kind: 'assistant' }),
    entry('said six'),
    entry('result seven', { kind: 'result' }),
    entry('call eight', { kind: 'call' }),
    entry('result nine', { kind: 'result' }),
  ])
  store.addChunks(ids.map((id, i) => ({ entry: id, seq: 0, vector: [1, 0.01 * (i + 1)] })))
  expect(store.semantic([1, 0], 2, {}, 2).map(h => h.id)).toEqual([ids[0]!, ids[1]!])
  expect(store.semantic([1, 0], 2, {}, 2, [['cmd', 'edit']]).map(h => h.id)).toEqual([ids[0]!, ids[1]!, ids[3]!, ids[4]!])
  expect(store.semantic([1, 0], 1, {}, 2, [['cmd', 'edit'], ['call', 'result']]).map(h => h.id)).toEqual([ids[0]!, ids[3]!, ids[6]!])
})

test('a vector search of another length than the stored vectors finds nothing', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [id] = store.addEntries([entry('near')])
  store.addChunks([{ entry: id!, seq: 0, vector: [1, 0] }])
  expect(store.semantic([1, 0, 0], 10, {})).toEqual([])
})

test('entries with vectors stop waiting, and a new model asks for every vector again', () => {
  store.useVectors({ model: 'm1', dimension: 2 })
  const [id] = store.addEntries([entry('a question about the deploy pipeline')])
  expect(store.pending(10)).toHaveLength(1)
  store.addChunks([{ entry: id!, seq: 0, vector: [1, 0] }])
  expect(store.pending(10)).toHaveLength(0)

  store.useVectors({ model: 'm1', dimension: 2 })
  expect(store.pending(10)).toHaveLength(0)

  store.useVectors({ model: 'm2', dimension: 4 })
  expect(store.pending(10)).toHaveLength(1)
})

test('dropping a session removes its entries and vectors', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [a, b] = store.addEntries([entry('keep this one', { session: 'keep' }), entry('drop this one', { session: 'gone' })])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0] },
    { entry: b!, seq: 0, vector: [0, 1] },
  ])
  store.dropSession('gone')
  expect(store.entries([a!, b!])).toHaveLength(1)
  expect((store.stats()).chunks).toBe(1)
})

test('dropping a source forgets its entries and how far it was read', () => {
  store.ingest('/t/a.jsonl', [entry('from a')], { size: 10, offset: 10 })
  store.ingest('/t/b.jsonl', [entry('from b')], { size: 10, offset: 10 })
  store.dropSource('/t/a.jsonl')
  expect(store.fileState('/t/a.jsonl')).toBeNull()
  expect(store.fileState('/t/b.jsonl')).not.toBeNull()
  expect((store.stats()).entries).toBe(1)
})

test('the number of entries waiting for a vector is counted', () => {
  store.addEntries([entry('a question about the deploy pipeline'), entry('another question about caching'), entry('ok')])
  expect(store.countPending()).toBe(2)
})

test('the stats count entries by kind, sessions and vectors', () => {
  store.addEntries([entry('x one', { session: 's1' }), entry('y two', { session: 's2', kind: 'cmd' })])
  expect(store.stats()).toEqual({ entries: 2, sessions: 2, agents: 0, chunks: 0, files: 0, redacted: 0, byKind: { cmd: 1, user: 1 }, model: null, dimension: null })
})

test('a store opened read-only can search and cannot write', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [id] = store.addEntries([entry('deploy notes')])
  store.addChunks([{ entry: id!, seq: 0, vector: [1, 0] }])
  const reader = Store.open(path, { readOnly: true })
  try {
    expect(reader.lexical(['deploy'], 5, {})).toHaveLength(1)
    expect(reader.semantic([1, 0], 5, {})).toHaveLength(1)
    expect(() => reader.addEntries([entry('more')])).toThrow()
  } finally {
    reader.close()
  }
})

test('a reader sees what the writer has stored while the writer is still open', () => {
  const reader = Store.open(path, { readOnly: true })
  try {
    store.addEntries([entry('deploy notes')])
    expect(reader.lexical(['deploy'], 5, {})).toHaveLength(1)
  } finally {
    reader.close()
  }
})

test('an entry whose key is already stored is left out, as a resumed session copies rows into a new file', () => {
  const first = store.ingest('/t/a.jsonl', [entry('one', { key: 'u1:0' }), entry('two', { key: 'u2:0' })], { size: 10, offset: 10 })
  const again = store.ingest('/t/b.jsonl', [entry('one', { key: 'u1:0', session: 's2' }), entry('three', { key: 'u3:0', session: 's2' })], { size: 10, offset: 10 })
  expect(first).toHaveLength(2)
  expect(again).toHaveLength(1)
  expect(textsOf(again.map(id => ({ id })))).toEqual(['three'])
  expect(store.stats().entries).toBe(3)
  expect(store.ingest('/t/c.jsonl', [entry('no key'), entry('no key')], { size: 1, offset: 1 })).toHaveLength(2)
})

test('a session keeps its newest title, and one the user typed is never replaced by one that was made up', () => {
  store.setTitles([{ session: 's1', title: 'First guess', isCustom: false }])
  store.setTitles([{ session: 's1', title: 'Second guess', isCustom: false }])
  expect(store.titles(['s1', 'none'])).toEqual(new Map([['s1', 'Second guess']]))
  store.setTitles([{ session: 's1', title: 'My own name', isCustom: true }])
  store.setTitles([{ session: 's1', title: 'Third guess', isCustom: false }])
  expect(store.titles(['s1']).get('s1')).toBe('My own name')
})

test('the latest sessions of a project come newest first, each with its title or its first prompt', () => {
  const day = (n: number) => Date.parse(`2026-10-0${n}T00:00:00Z`)
  store.addEntries([
    entry('fix the login page', { session: 'old', ts: day(1) }),
    entry('Done.', { session: 'old', ts: day(2), kind: 'assistant' }),
    entry('add dark mode', { session: 'new', ts: day(3), project: '/work/app/web' }),
    entry('inside a sub-agent', { session: 'agent', parent: 'new', ts: day(4) }),
    entry('another project', { session: 'far', ts: day(5), project: '/work/application' }),
  ])
  store.setTitles([{ session: 'old', title: 'Login page fix', isCustom: false }])
  expect(store.recent('/work/app', 5)).toEqual([
    { session: 'new', project: '/work/app/web', last: day(3), title: null, asked: 'add dark mode', ended: null },
    { session: 'old', project: '/work/app', last: day(2), title: 'Login page fix', asked: 'fix the login page', ended: 'Done.' },
  ])
  expect(store.recent('/work/app', 5, '', false, true).map(s => s.session)).toEqual(['old'])
  expect(store.recent('/work/app', 5, 'new').map(s => s.session)).toEqual(['old'])
  expect(store.recent('/work/app', 1).map(s => s.session)).toEqual(['new'])
  expect(store.recent('', 9).map(s => s.session)).toEqual(['far', 'new', 'old'])
  expect(store.recent('', 9, '', true).map(s => s.session)).toEqual(['old'])
})

test('forgetting a session forgets its title', () => {
  store.addEntries([entry('secret work', { session: 's9' })])
  store.setTitles([{ session: 's9', title: 'Secret work', isCustom: false }])
  store.forget('s9', 1)
  expect(store.titles(['s9']).size).toBe(0)
})

test('an index of the version before is brought up in place: its entries stay, and every file is read again', () => {
  store.ingest('/t/gone.jsonl', [entry('kept from a transcript that was deleted')], { size: 10, offset: 10 })
  store.fileTools = 'mcp__files'
  store.close()
  const old = new Database(path)
  old.exec("drop index entries_key; alter table entries drop column key; drop table titles; alter table files drop column calls; update meta set value = '8' where key = 'schema'")
  old.close()

  store = Store.open(path)
  expect(store.stats().entries).toBe(1)
  expect(store.fileState('/t/gone.jsonl')).toBeNull()
  expect(store.fileTools).toBe('mcp__files')
  expect(store.ingest('/t/new.jsonl', [entry('a', { key: 'u1:0' }), entry('a', { key: 'u1:0' })], { size: 1, offset: 1 })).toHaveLength(1)
  store.setTitles([{ session: 's1', title: 'Named', isCustom: false }])
  expect(store.titles(['s1']).get('s1')).toBe('Named')
})

test('an index of 32-bit vectors is brought up to bytes in place: the order they give stays, its 8-bit copy goes, and no file is read again', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const [a, b] = store.addEntries([entry('alpha'), entry('beta')])
  store.addChunks([
    { entry: a!, seq: 0, vector: [0, 0, 1] },
    { entry: b!, seq: 0, vector: [1, 0, 0] },
  ])
  store.setFileState('/t/kept.jsonl', { size: 10, offset: 10 })
  store.close()
  const old = new Database(path)
  old.loadExtension(getExtensionPath())
  const floats = (v: number[]): Uint8Array => new Uint8Array(Float32Array.from(v).buffer)
  old.query('update chunks set embedding = ? where entry = ?').run(floats([0.9, 0.1, 0.2]), a!)
  old.query('update chunks set embedding = ? where entry = ?').run(floats([0.1, 0.8, 0.3]), b!)
  old.query("select vector_init('chunks', 'embedding', 'dimension=3,type=FLOAT32,distance=COSINE')").get()
  old.query("select vector_quantize('chunks', 'embedding', 'qtype=INT8')").get()
  old.exec("alter table files drop column calls; update meta set value = '9' where key = 'schema'; insert or replace into meta (key, value) values ('compact', '1')")
  old.close()

  store = Store.open(path)
  expect(store.fileState('/t/kept.jsonl')).toEqual({ size: 10, offset: 10 })
  expect(store.semantic([1, 0, 0], 10, {}, 2).map(h => h.id)).toEqual([a!, b!])
  const raw = new Database(path, { readonly: true })
  expect((raw.query('select length(embedding) as n from chunks').all() as { n: number }[]).map(r => r.n)).toEqual([3, 3])
  expect(raw.query("select 1 from sqlite_master where name like 'vector0_%'").get()).toBeNull()
  expect(raw.query("select 1 from meta where key = 'compact'").get()).toBeNull()
  raw.close()
})

test('an index of a version with no path to this one is emptied', () => {
  store.addEntries([entry('old shape')])
  store.close()
  const old = new Database(path)
  old.exec("update meta set value = '3' where key = 'schema'")
  old.close()
  store = Store.open(path)
  expect(store.stats().entries).toBe(0)
})

test('a second writer is refused while the first is open', () => {
  expect(() => Store.open(path)).toThrow(StoreBusyError)
  store.close()
  store = Store.open(path)
})

test('reading an index that is not there says so', () => {
  expect(() => Store.open(join(dir, 'none.sqlite'), { readOnly: true })).toThrow(StoreMissingError)
})
