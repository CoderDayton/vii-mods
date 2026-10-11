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

test('commands that match the words better leave room for what was said', async () => {
  store.addEntries([
    ...Array.from({ length: 80 }, (_, i) => entry(`deploy deploy --target ${i}`, { kind: 'cmd', session: 'shell' })),
    entry('We agreed that a deploy needs a second person to approve it, and wrote that into the release notes.', { session: 'talk' }),
  ])
  expect((await ask('deploy', null)).hits.map(h => h.session).sort()).toEqual(['shell', 'talk'])
})

test('a kind asked for is the only kind searched', async () => {
  store.addEntries([entry('deploy --target 1', { kind: 'cmd', session: 'shell' }), entry('The deploy went out.', { session: 'talk' })])
  expect((await ask('deploy', null, { kinds: ['cmd'] })).hits.map(h => h.session)).toEqual(['shell'])
})

const TURNS = [
  entry('The importer drops rows that have no date.', { kind: 'user', session: 'fix' }),
  entry('rg -n "row.date" src/importer.ts', { kind: 'cmd', session: 'fix' }),
  entry('The check treated an empty string as missing; it now tests for undefined.', { session: 'fix' }),
  entry('Now rename the flag to --strict.', { kind: 'user', session: 'fix' }),
  entry('Renamed the flag and its help text.', { session: 'fix' }),
]

test('a matched command comes with its turn: the prompt, how the turn ended and what the user said next', async () => {
  const ids = store.addEntries(TURNS)
  const [found] = (await ask('rg row.date importer.ts', null, { kinds: ['cmd'] })).hits[0]!.entries
  expect(found).toMatchObject({
    turn: ids[0]!,
    asked: 'The importer drops rows that have no date.',
    ended: 'The check treated an empty string as missing; it now tests for undefined.',
    reply: 'Now rename the flag to --strict.',
  })
})

test('a turn ends with the last thing Claude said in it, not the first', async () => {
  store.addEntries([
    entry('Why does the importer drop rows?', { kind: 'user', session: 'long' }),
    entry('Let me look at the importer first.', { session: 'long' }),
    entry('rg -n "row.date" src/importer.ts', { kind: 'cmd', session: 'long' }),
    entry('Cause found: an empty date string was read as missing.', { session: 'long' }),
  ])
  const [prompt] = (await ask('importer drop rows', null, { kinds: ['user'] })).hits[0]!.entries
  expect(prompt?.ended).toBe('Cause found: an empty date string was read as missing.')
  expect(prompt?.reply).toBeUndefined()
})

test('a matched prompt comes with its answer, and a matched answer with its prompt', async () => {
  store.addEntries(TURNS)
  const [prompt] = (await ask('importer drops rows', null, { kinds: ['user'] })).hits[0]!.entries
  expect(prompt).toMatchObject({ kind: 'user', ended: 'The check treated an empty string as missing; it now tests for undefined.' })
  expect(prompt?.asked).toBeUndefined()
  const [answer] = (await ask('renamed help text', null, { kinds: ['assistant'] })).hits[0]!.entries
  expect(answer?.asked).toBe('Now rename the flag to --strict.')
  expect(answer?.reply).toBeUndefined()
})

test('a prompt that got no answer before the next prompt has none', async () => {
  store.addEntries([entry('Why is the importer slow?', { kind: 'user', session: 'q' }), entry('Never mind, look at the exporter.', { kind: 'user', session: 'q' }), entry('The exporter is fine.', { session: 'q' })])
  const [prompt] = (await ask('importer slow', null)).hits[0]!.entries
  expect(prompt?.ended).toBeUndefined()
  expect(prompt?.reply).toBe('Never mind, look at the exporter.')
})

test('a hit names the files its session changed, the most changed first', async () => {
  store.addEntries(TURNS)
  const touch = (path: string, action: 'read' | 'edit') => ({ path, action, tool: 'Edit', ts: NOW - DAY, session: 'fix', project: '/work/app' })
  store.addTouches([touch('/work/app/src/a.ts', 'edit'), touch('/work/app/src/importer.ts', 'edit'), touch('/work/app/src/importer.ts', 'edit'), touch('/work/app/README.md', 'read')], '/t/fix.jsonl')
  expect((await ask('importer drops rows', null)).hits[0]?.files).toEqual(['/work/app/src/importer.ts', '/work/app/src/a.ts'])
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
