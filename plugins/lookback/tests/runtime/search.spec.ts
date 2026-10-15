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
  searchPast(store, embedder, query, { now: NOW, order: 'best', ...extra })

const local = (day: number, hour = 12): number => new Date(2026, 9, day, hour).getTime()

test('sessions are listed newest first, and best first when asked', async () => {
  store.addEntries([
    entry('pillow thumbnails', { session: 'old', ts: NOW - 2 * DAY }),
    entry('the pillow package made a lot of long thumbnails for the gallery page in the end', { session: 'new', ts: NOW - DAY }),
  ])
  expect((await ask('pillow thumbnails', null)).hits.map(h => h.session)).toEqual(['old', 'new'])
  expect((await ask('pillow thumbnails', null, { order: 'newest' })).hits.map(h => h.session)).toEqual(['new', 'old'])
  expect((await searchPast(store, null, 'pillow thumbnails', { now: NOW })).hits[0]?.session).toBe('new')
})

test('a span of time in the question limits the search and is not a word of it', async () => {
  store.addEntries([entry('pillow install on the build box', { session: 'sun', ts: local(11) }), entry('pillow install on the laptop', { session: 'sat', ts: local(10) })])
  const found = await searchPast(store, null, 'pillow install yesterday', { now: local(12, 15) })
  expect(found.hits.map(h => h.session)).toEqual(['sun'])
  expect(found.terms).toEqual(['pillow', 'install'])
})

test('what a tool returned, what a tool was asked and a compaction summary are found, under what was said', async () => {
  const text = 'the connection pool hands out sockets'
  store.addEntries([
    entry(text, { session: 'said' }),
    entry(text, { session: 'returned', kind: 'result' }),
    entry(text, { session: 'asked', kind: 'call' }),
    entry(text, { session: 'compacted', kind: 'summary' }),
  ])
  expect((await ask('connection pool sockets', null)).hits.map(h => h.session)).toEqual(['said', 'compacted', 'asked', 'returned'])
  expect((await ask('connection pool sockets', null, { kinds: ['result'] })).hits.map(h => h.session)).toEqual(['returned'])
})

test('a word match needs two fifths of the words of a question of three or more', async () => {
  store.addEntries([
    entry('the cache ttl is five minutes', { session: 'two' }),
    entry('the cache was cleared', { session: 'one' }),
  ])
  const long = await ask('cache ttl expiry eviction policy', null, { keywordOnly: true })
  expect(long.hits.map(h => h.session)).toEqual(['two'])
  const short = await ask('cache ttl', null, { keywordOnly: true })
  expect(short.hits.map(h => h.session).sort()).toEqual(['one', 'two'])
})

test('a long question keeps its rarest words, wherever they stand', async () => {
  store.addEntries([
    ...['alpha bravo charlie delta', 'echo foxtrot golf hotel', 'alpha golf india', 'bravo echo hotel'].map((text, i) => entry(text, { session: `common${i}` })),
    entry('the zebrafish run', { session: 'rare' }),
  ])
  const found = await ask('alpha bravo charlie delta echo foxtrot golf hotel india zebrafish', null)
  expect(found.terms).toHaveLength(8)
  expect(found.terms).toContain('zebrafish')
  expect(found.terms).not.toContain('hotel')
})

test('a question that is only about time lists the sessions of that time, newest first', async () => {
  const now = local(12, 15)
  store.addEntries([
    entry('Make thumbnails', { kind: 'user', session: 'a', ts: local(11, 9) }),
    entry('The thumbnails are made.', { session: 'a', ts: local(11, 10) }),
    entry('The loader is renamed.', { session: 'b', ts: local(11, 14) }),
    entry('Older work.', { session: 'c', ts: local(9) }),
  ])
  const found = await searchPast(store, null, 'what did we do yesterday', { now })
  expect(found.hits.map(h => h.session)).toEqual(['b', 'a'])
  expect(found.hits[1]?.entries[0]?.text).toBe('The thumbnails are made.')
  expect((await searchPast(store, null, 'what did we do last session', { now, limit: 1 })).hits.map(h => h.session)).toEqual(['b'])
  expect((await searchPast(store, null, 'what did we do', { now })).hits).toEqual([])
  const fromB = await searchPast(store, null, 'what did we do last session', { now, limit: 1, sessionBefore: { session: 'b', ts: now } })
  expect(fromB.hits.map(h => h.session)).toEqual(['a'])
})

test('a question that names a project folder and asks for the latest finds the newest sessions of that folder', async () => {
  const filler = Array.from({ length: 70 }, (_, i) => entry('lunetrain work lunetrain work', { session: `f${i}`, project: '/work/other', ts: NOW - 40 * DAY }))
  store.addEntries([
    ...filler,
    entry('The training loop work is faster now.', { session: 'loop', project: '/work/lunetrain', ts: NOW - 3 * DAY }),
    entry('Loader mismatch work is done.', { session: 'loader', project: '/work/lunetrain', ts: NOW - 2 * DAY }),
    entry('The latest news is nothing.', { session: 'news', project: '/work/other', ts: NOW - DAY }),
    entry('Notes on the lunetrain work.', { session: 'agent', parent: 'loop', project: '/work/lunetrain', ts: NOW - DAY / 2 }),
  ])
  const found = await ask('latest lunetrain work', null, { limit: 2 })
  expect(found.terms).toEqual(['lunetrain', 'work'])
  expect(found.hits.map(h => h.session)).toEqual(['loader', 'loop'])
})

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
