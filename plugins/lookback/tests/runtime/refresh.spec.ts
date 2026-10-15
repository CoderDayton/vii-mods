import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { indexAll, refreshSession } from '../../src/runtime/indexer'
import { Store } from '../../src/runtime/store/store'
import { FakeEmbedder, Projects, assistantRow, tempDir, userRow } from './helpers'

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

const texts = (): string[] =>
  store
    .sessions('', 50)
    .flatMap(s => store.sessionEntries(s.session, { limit: 50, offset: 0 }))
    .map(e => e.text)
    .sort()

test('a refresh reads the new lines of one session and leaves the other transcripts unread', async () => {
  const mine = projects.write('proj', 'mine', [userRow('first question about the parser', { session: 'mine' })])
  projects.write('proj', 'other', [userRow('a question in another session', { session: 'other' })])
  await indexAll(store, { projectsRoot: projects.root, embedder: null })

  projects.append(mine, [assistantRow('first answer about the parser', { session: 'mine' })])
  projects.write('proj', 'third', [userRow('a session started since the last run', { session: 'third' })])
  const report = await refreshSession(store, { projectsRoot: projects.root, session: 'mine', embedder: null })

  expect(report).toMatchObject({ files: 1, entries: 1 })
  expect(texts()).toEqual(['a question in another session', 'first answer about the parser', 'first question about the parser'])
})

test('a refresh of a session with no transcript reads nothing', async () => {
  expect(await refreshSession(store, { projectsRoot: projects.root, session: 'absent', embedder: null })).toMatchObject({ files: 0, entries: 0 })
})

test('a refresh embeds the new entries, and a search by meaning finds them at once', async () => {
  const mine = projects.write('proj', 'mine', [userRow('first question about the parser', { session: 'mine' })])
  const embedder = new FakeEmbedder()
  await indexAll(store, { projectsRoot: projects.root, embedder })

  projects.append(mine, [assistantRow('Rotate the signing key before the release goes out.', { session: 'mine' })])
  const report = await refreshSession(store, { projectsRoot: projects.root, session: 'mine', embedder })
  expect(report.chunks).toBe(1)
  const [vector] = await embedder.embed(['rotate signing key release'], 'query')
  expect(store.entries(store.semantic(vector!, 1, {}).map(h => h.id))[0]?.text).toContain('signing key')
})

test('a refresh embeds the entries of its own session only, whatever else waits for a vector', async () => {
  const mine = projects.write('proj', 'mine', [userRow('first question about the parser', { session: 'mine' })])
  const embedder = new FakeEmbedder()
  await indexAll(store, { projectsRoot: projects.root, embedder })
  projects.write('proj', 'other', [userRow('an older question that never got a vector', { session: 'other' })])
  await indexAll(store, { projectsRoot: projects.root, embedder: null })

  projects.append(mine, [assistantRow('Rotate the signing key before the release goes out.', { session: 'mine' })])
  embedder.calls.length = 0
  const report = await refreshSession(store, { projectsRoot: projects.root, session: 'mine', embedder })
  expect(report.chunks).toBe(1)
  expect(embedder.calls.flatMap(c => c.texts)).toEqual(['Rotate the signing key before the release goes out.'])
  expect(store.pending(10).map(e => e.text)).toEqual(['an older question that never got a vector'])
})

test('a refresh with no time for vectors, or with another model than the index holds, embeds nothing', async () => {
  const mine = projects.write('proj', 'mine', [userRow('first question about the parser', { session: 'mine' })])
  await indexAll(store, { projectsRoot: projects.root, embedder: new FakeEmbedder('model-a') })
  projects.append(mine, [assistantRow('Rotate the signing key before the release goes out.', { session: 'mine' })])

  expect((await refreshSession(store, { projectsRoot: projects.root, session: 'mine', embedder: new FakeEmbedder('model-a'), embedMs: 0 })).chunks).toBe(0)
  expect((await refreshSession(store, { projectsRoot: projects.root, session: 'mine', embedder: new FakeEmbedder('model-b') })).chunks).toBe(0)
  expect(store.stats()).toMatchObject({ model: 'model-a', chunks: 1 })
  expect(store.pending(10)).toHaveLength(1)
})
