import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { searchPast } from '../../src/runtime/search'
import { Store } from '../../src/runtime/store/store'
import type { Entry } from '../../src/core/types'
import { FakeEmbedder, pad, tempDir } from './helpers'

const NOW = Date.parse('2026-10-11T00:00:00Z')
const DAY = 86_400_000

let tmp: ReturnType<typeof tempDir>
let store: Store

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({ kind: 'assistant', text, ts: NOW - DAY, session: 's1', project: '/work/app', ...extra })

beforeEach(() => {
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  tmp.remove()
})

const ask = (query: string, embedder: FakeEmbedder | null, extra: Partial<Parameters<typeof searchPast>[3]> = {}) =>
  searchPast(store, embedder, query, { now: NOW, ...extra })

test('a keyword search finds the session that holds the words', async () => {
  store.addEntries([entry('Fixed ModuleNotFoundError by reinstalling pillow', { session: 'hit' }), entry('Renamed a variable', { session: 'miss' })])
  const result = await ask('ModuleNotFoundError', null)
  expect(result.hits.map(h => h.session)).toEqual(['hit'])
  expect(result.semantic).toBe('off')
  expect(result.terms).toEqual(['modulenotfounderror'])
})

test('a vector search finds a session that shares no word with the question', async () => {
  store.useVectors({ model: 'fake', dimension: 32 })
  const [a, b] = store.addEntries([entry('We settled on tabs for indentation', { session: 'style' }), entry('Rotated the API key', { session: 'secrets' })])
  store.addChunks([
    { entry: a!, seq: 0, vector: pad([1, 0]) },
    { entry: b!, seq: 0, vector: pad([0, 1]) },
  ])
  const embedder = new FakeEmbedder('fake', { 'how should whitespace look': pad([0.9, 0.1]) })
  const result = await ask('how should whitespace look', embedder)
  expect(result.hits.map(h => h.session)).toEqual(['style'])
  expect(result.semantic).toBe('used')
  expect(embedder.calls[0]?.role).toBe('query')
})

test('a session found by both searches leads', async () => {
  store.useVectors({ model: 'fake', dimension: 32 })
  const [both, keywordOnly, meaningOnly] = store.addEntries([
    entry('deploy pipeline rollback steps', { session: 'both' }),
    entry('deploy deploy deploy', { session: 'keyword' }),
    entry('shipping process reversal notes', { session: 'meaning' }),
  ])
  store.addChunks([
    { entry: both!, seq: 0, vector: pad([1, 0]) },
    { entry: keywordOnly!, seq: 0, vector: pad([0, 0, 1]) },
    { entry: meaningOnly!, seq: 0, vector: pad([0.95, 0.05]) },
  ])
  const embedder = new FakeEmbedder('fake', { 'deploy rollback': pad([1, 0]) })
  const result = await ask('deploy rollback', embedder)
  expect(result.hits[0]?.session).toBe('both')
  expect(result.hits.map(h => h.session)).toContain('meaning')
})

test('keyword mode never calls the embedding server', async () => {
  store.addEntries([entry('deploy notes')])
  const embedder = new FakeEmbedder()
  const result = await ask('deploy', embedder, { keywordOnly: true })
  expect(result.hits).toHaveLength(1)
  expect(embedder.calls).toHaveLength(0)
  expect(result.semantic).toBe('off')
})

test('a server that is down leaves the keyword hits and says so', async () => {
  store.useVectors({ model: 'fake', dimension: 32 })
  store.addEntries([entry('deploy notes')])
  const embedder = new FakeEmbedder()
  embedder.failing = true
  const result = await ask('deploy', embedder)
  expect(result.hits).toHaveLength(1)
  expect(result.semantic).toBe('unavailable')
})

test('the asking session is left out, and the filters apply', async () => {
  store.addEntries([
    entry('deploy notes', { session: 'now', project: '/work/app' }),
    entry('deploy notes', { session: 'then', project: '/work/app' }),
    entry('deploy notes', { session: 'other', project: '/work/api' }),
  ])
  expect((await ask('deploy', null, { excludeSession: 'now' })).hits.map(h => h.session).sort()).toEqual(['other', 'then'])
  expect((await ask('deploy', null, { project: 'api' })).hits.map(h => h.session)).toEqual(['other'])
})

test('a question of nothing but filler finds nothing and costs no query', async () => {
  store.addEntries([entry('deploy notes')])
  const embedder = new FakeEmbedder()
  const result = await ask('what was that again', embedder)
  expect(result.hits).toEqual([])
  expect(embedder.calls).toHaveLength(0)
})

test('the number of sessions returned follows the limit', async () => {
  store.addEntries(Array.from({ length: 6 }, (_, i) => entry('deploy notes', { session: `s${i}` })))
  expect((await ask('deploy', null, { limit: 3 })).hits).toHaveLength(3)
})
