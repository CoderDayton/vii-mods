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

test('a project filter that holds a wildcard character is taken literally', () => {
  store.addEntries([entry('deploy', { project: '/work/my_app' }), entry('deploy', { project: '/work/myXapp' })])
  expect(store.lexical(['deploy'], 10, { project: 'my_app' })).toHaveLength(1)
})

test('only prose entries long enough to mean something wait for a vector', () => {
  store.addEntries([
    entry('yes'),
    entry('a question about the deploy pipeline'),
    entry('git status --short --branch', { kind: 'cmd' }),
    entry('EACCES: permission denied, open the file', { kind: 'error' }),
  ])
  const pending = store.pending(10)
  expect(pending.map(p => p.text).sort()).toEqual(['EACCES: permission denied, open the file', 'a question about the deploy pipeline'])
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

test('vectors are found the same before and after the compact index is built, and so is one added later', () => {
  store.useVectors({ model: 'm', dimension: 3 })
  const [a, b, c] = store.addEntries([entry('alpha'), entry('beta'), entry('gamma')])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0, 0] },
    { entry: b!, seq: 0, vector: [0, 1, 0] },
  ])
  const nearest = (): number[] => store.semantic([0.1, 0.1, 1], 10, {}, 2).map(h => h.id)
  const before = nearest()
  store.compactVectors()
  expect(nearest()).toEqual(before)

  store.addChunks([{ entry: c!, seq: 0, vector: [0, 0, 1] }])
  expect(nearest()[0]).toBe(c!)
  store.compactVectors()
  expect(nearest()[0]).toBe(c!)
})

test('a vector search does not return an entry that was removed after the compact index was built', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const [a, b] = store.addEntries([entry('keep', { session: 'keep' }), entry('drop', { session: 'gone' })])
  store.addChunks([
    { entry: a!, seq: 0, vector: [1, 0] },
    { entry: b!, seq: 0, vector: [0, 1] },
  ])
  store.compactVectors()
  store.dropSession('gone')
  expect(store.semantic([0, 1], 10, {}, 2).map(h => h.id)).toEqual([a!])
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
  expect(store.stats()).toEqual({ entries: 2, sessions: 2, chunks: 0, byKind: { cmd: 1, user: 1 }, model: null, dimension: null })
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

test('a second writer is refused while the first is open', () => {
  expect(() => Store.open(path)).toThrow(StoreBusyError)
  store.close()
  store = Store.open(path)
})

test('reading an index that is not there says so', () => {
  expect(() => Store.open(join(dir, 'none.sqlite'), { readOnly: true })).toThrow(StoreMissingError)
})
