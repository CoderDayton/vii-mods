import { afterEach, beforeEach, expect, test } from 'bun:test'
import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { entriesOf } from '../../src/core/transcript/entries'
import { indexAll } from '../../src/runtime/indexer'
import type { Progress } from '../../src/runtime/indexer'
import { searchPast } from '../../src/runtime/search'
import { Store } from '../../src/runtime/store/store'
import { FakeEmbedder, Projects, assistantRow, commandRow, resultRow, summaryRow, tempDir, toolRow, userRow } from './helpers'

let projects: Projects
let tmp: ReturnType<typeof tempDir>
let store: Store

beforeEach(() => {
  projects = new Projects()
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  projects.remove()
  tmp.remove()
})

const run = (embedder: FakeEmbedder | null, onProgress?: (p: Progress) => void) =>
  indexAll(store, { projectsRoot: projects.root, embedder, onProgress })

test('new transcripts are read into entries, and the report says how many', async () => {
  projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' }), assistantRow('The lockfile was stale; reinstall.', { session: 's1' })])
  const report = await run(null)
  expect(report).toMatchObject({ files: 1, entries: 2, embeddingError: null })
  expect((store.stats()).entries).toBe(2)
})

const pool = 'The pool hands out sockets and queues a caller when none is free, then times out.'

const withTools = (): string[] => [
  userRow('How does the connection pool behave when it is empty?', { session: 's1' }),
  toolRow('mcp__searxng__web_read', { url: 'https://example.com/pool' }, { session: 's1', uuid: 'a1' }),
  resultRow(pool, { session: 's1', uuid: 'a2' }),
  summaryRow('The session read about the pool.', { session: 's1', uuid: 'a3' }),
]

test('the calls of other tools, what they returned and a compaction summary are read, the result headed by its call', async () => {
  projects.write('proj', 's1', withTools())
  await run(null)
  expect(store.stats().byKind).toEqual({ user: 1, call: 1, result: 1, summary: 1 })
  const [hit] = (await searchPast(store, null, 'sockets queues caller times out', { now: Date.now(), kinds: ['result'] })).hits
  expect(hit?.entries[0]?.text).toBe(`mcp__searxng__web_read https://example.com/pool\n${pool}`)
})

test('a result read in a later run than its call is still headed by it, and an edit read so is still left out', async () => {
  const path = projects.write('proj', 's1', [
    userRow('How does the connection pool behave when it is empty?', { session: 's1' }),
    toolRow('mcp__searxng__web_read', { url: 'https://example.com/pool' }, { session: 's1', uuid: 'a1' }),
  ])
  await run(null)
  projects.append(path, [resultRow(pool, { session: 's1', uuid: 'a2' })])
  await run(null)
  projects.append(path, [
    toolRow('Edit', { file_path: '/work/app/pool.ts', old_string: 'a', new_string: 'b' }, { session: 's1', uuid: 'a3' }),
  ])
  await run(null)
  projects.append(path, [resultRow('The file /work/app/pool.ts has been updated successfully, and here is a snippet.', { session: 's1', uuid: 'a4' })])
  await run(null)
  const [hit] = (await searchPast(store, null, 'sockets queues caller times out', { now: Date.now(), kinds: ['result'] })).hits
  expect(hit?.entries.map(e => e.text)).toEqual([`mcp__searxng__web_read https://example.com/pool\n${pool}`])
  expect(store.stats().byKind.result).toBe(1)
})

test('transcripts read before these kinds were read give them once, and the entries they already had stay', async () => {
  const lines = withTools()
  const path = projects.write('proj', 's1', lines)
  const before = lines.flatMap(line => entriesOf(line))
  store.ingest(path, before, { size: statSync(path).size, offset: statSync(path).size })
  expect(store.stats().byKind).toEqual({ user: 1 })
  await run(null)
  expect(store.stats().byKind).toEqual({ user: 1, call: 1, result: 1, summary: 1 })
  await run(null)
  expect(store.stats().entries).toBe(4)
})

test('a second run with nothing new reads nothing', async () => {
  projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' })])
  await run(null)
  const again = await run(null)
  expect(again).toMatchObject({ files: 0, entries: 0, chunks: 0 })
})

test('lines added to a transcript are read once, with none of the old ones repeated', async () => {
  const path = projects.write('proj', 's1', [userRow('first question about the parser', { session: 's1' })])
  await run(null)
  projects.append(path, [assistantRow('first answer about the parser', { session: 's1' })])
  const report = await run(null)
  expect(report).toMatchObject({ files: 1, entries: 1 })
  expect((store.stats()).entries).toBe(2)
})

test('a line cut short by a write in progress is read when it is finished', async () => {
  const path = projects.write('proj', 's1', [userRow('a complete question about caching', { session: 's1' })])
  const partial = assistantRow('an answer that is still being written out', { session: 's1' })
  writeFileSync(path, `${userRow('a complete question about caching', { session: 's1' })}\n${partial.slice(0, 40)}`)
  expect((await run(null)).entries).toBe(1)
  writeFileSync(path, `${userRow('a complete question about caching', { session: 's1' })}\n${partial}\n`)
  expect((await run(null)).entries).toBe(1)
  expect((store.stats()).entries).toBe(2)
})

test('a transcript that was rewritten shorter is read again from the start', async () => {
  const path = projects.write('proj', 's1', [userRow('an old question that is long enough to matter', { session: 's1' }), assistantRow('an old answer that is long enough to matter', { session: 's1' })])
  await run(null)
  writeFileSync(path, `${userRow('new', { session: 's1' })}\n`)
  const report = await run(null)
  expect(report.entries).toBe(1)
  expect((store.stats()).entries).toBe(1)
})

test('a file with entries on record but no read position is read again in place of them, not on top', async () => {
  const path = projects.write('proj', 's1', [userRow('first question about the parser', { session: 's1' })])
  await run(null)
  store.ingest('/gone/s0.jsonl', [{ kind: 'user', text: 'from a deleted transcript', ts: 1, session: 's0', project: '/work/app' }], { size: 5, offset: 5 })
  store.forgetReadPositions()
  expect(store.fileState(path)).toBeNull()
  await run(null)
  expect(store.stats().entries).toBe(2)
  expect(store.sessions('s0')).toHaveLength(1)
})

test('prose and shell commands both get vectors', async () => {
  projects.write('proj', 's1', [
    userRow('How do I fix the build error in the parser?', { session: 's1' }),
    assistantRow('The lockfile was stale, so reinstall the packages.', { session: 's1' }),
    commandRow('bun install --frozen-lockfile', { session: 's1' }),
  ])
  const embedder = new FakeEmbedder()
  const report = await run(embedder)
  expect(report.chunks).toBe(3)
  expect(store.pending(10)).toEqual([])
  expect(embedder.calls.every(c => c.role === 'document')).toBe(true)
  expect(embedder.calls.flatMap(c => c.texts).join(' ')).toContain('frozen-lockfile')
})

test('after a run the entries are found by meaning, also the ones a later run adds', async () => {
  const path = projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' })])
  const embedder = new FakeEmbedder()
  await run(embedder)
  const nearest = async (text: string): Promise<string[]> => {
    const [vector] = await embedder.embed([text], 'query')
    return store.entries(store.semantic(vector!, 5, {}).map(h => h.id)).map(e => e.text)
  }
  expect(await nearest('build error parser')).toEqual(['How do I fix the build error in the parser?'])

  projects.append(path, [assistantRow('Rotate the signing key before the release goes out.', { session: 's1' })])
  await run(embedder)
  expect((await nearest('rotate signing key release'))[0]).toBe('Rotate the signing key before the release goes out.')
})

test('a long message is embedded in several passages', async () => {
  const paragraphs = Array.from({ length: 3 }, (_, i) => `${'Paragraph '.concat(String(i), ' says things. ').repeat(40)}`)
  projects.write('proj', 's1', [assistantRow(paragraphs.join('\n\n'), { session: 's1' })])
  expect((await run(new FakeEmbedder())).chunks).toBeGreaterThan(1)
})

test('when the embedding server is down the entries are kept and the error is reported', async () => {
  projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' })])
  const embedder = new FakeEmbedder()
  embedder.failing = true
  const report = await run(embedder)
  expect(report.entries).toBe(1)
  expect(report.chunks).toBe(0)
  expect(report.embeddingError).toContain('down')

  embedder.failing = false
  const later = await run(embedder)
  expect(later).toMatchObject({ files: 0, entries: 0, chunks: 1, embeddingError: null })
})

test('a different embedding model makes every vector again', async () => {
  projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' })])
  await run(new FakeEmbedder('model-a'))
  const report = await run(new FakeEmbedder('model-b'))
  expect(report.chunks).toBe(1)
  expect((store.stats()).model).toBe('model-b')
})

test('progress is reported for the transcripts and for the vectors', async () => {
  projects.write('proj', 's1', [userRow('How do I fix the build error in the parser?', { session: 's1' })])
  const seen: Progress[] = []
  await run(new FakeEmbedder(), p => seen.push(p))
  expect(new Set(seen.map(p => p.phase))).toEqual(new Set(['transcripts', 'embedding']))
  expect(seen.at(-1)).toMatchObject({ phase: 'embedding', done: 1, total: 1 })
})
