import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { recallPast } from '../../src/runtime/recall'
import { Store } from '../../src/runtime/store/store'
import type { Entry } from '../../src/core/types'
import { FakeEmbedder, pad, tempDir } from './helpers'

const NOW = Date.parse('2026-10-11T00:00:00Z')
const DAY = 86_400_000
const PROMPT = 'can we move the commits to a new release branch with a version number'
const NEAR = pad([0.97, 0.1])

let tmp: ReturnType<typeof tempDir>
let store: Store

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({ kind: 'user', text, ts: NOW - DAY, session: 'past', project: '/work/app', ...extra })

// Stores entries with the vector the prompt is near, after enough other entries that no word of the prompt is common.
const seed = (entries: Entry[], vectors = entries.map(() => NEAR)): void => {
  store.useVectors({ model: 'fake', dimension: 32 })
  store.addEntries(Array.from({ length: 60 }, (_, i) => entry(`Unrelated note number ${i} about something else`, { kind: 'assistant', session: 'filler' })))
  const ids = store.addEntries(entries)
  store.addChunks(ids.map((id, i) => ({ entry: id, seq: 0, vector: vectors[i] ?? NEAR })))
}

const embedder = (): FakeEmbedder => new FakeEmbedder('fake', { [PROMPT]: pad([1, 0]) })

const recall = (extra: Partial<Parameters<typeof recallPast>[3]> = {}, with_ = embedder()) =>
  recallPast(store, with_, PROMPT, { now: NOW, project: '/work/app', exclude: 'now', skip: new Set(), ...extra })

beforeEach(() => {
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  tmp.remove()
})

test('an earlier entry of this folder that says nearly the same is recalled', async () => {
  seed([entry('Move the commits to a new release branch, release/0.3')])
  const { hits } = await recall()
  expect(hits.map(h => h.session)).toEqual(['past'])
  expect(hits[0]?.entries[0]?.text).toContain('release branch')
})

test('what happened in another folder is not recalled', async () => {
  seed([entry('Move the commits to a new release branch, release/0.3', { project: '/work/other' })])
  expect((await recall()).hits).toEqual([])
})

test('the session asking, and sessions already shown, are left out', async () => {
  seed([entry('Move the commits to a new release branch', { session: 'now' }), entry('Move the commits to a new release branch', { session: 'shown' })])
  expect((await recall({ skip: new Set(['shown']) })).hits).toEqual([])
})

test('a session already shown is known by the start of its id', async () => {
  seed([entry('Move the commits to a new release branch', { session: 'abcdef12-0000-4000-8000-000000000000' })])
  expect((await recall({ skip: new Set(['abcdef12']) })).hits).toEqual([])
})

test('an entry that shares only one telling word is not recalled', async () => {
  seed([entry('The release schedule is on the wiki')])
  expect((await recall()).hits).toEqual([])
})

test('an entry that means something else is not recalled', async () => {
  seed([entry('Move the commits to a new release branch')], [pad([0, 1])])
  expect((await recall()).hits).toEqual([])
})

test('at most two sessions come back', async () => {
  seed(['a', 'b', 'c'].map(s => entry('Move the commits to a new release branch', { session: s })))
  expect((await recall()).hits).toHaveLength(2)
})

test('a prompt that is not a question about the past never reaches the embedding server', async () => {
  seed([entry('Move the commits to a new release branch')])
  const fake = embedder()
  const result = await recallPast(store, fake, '/code-review medium --fix on the branch', { now: NOW, project: '/work/app', exclude: 'now', skip: new Set() })
  expect(result.hits).toEqual([])
  expect(fake.calls).toEqual([])
})

test('an embedding server that does not answer leaves nothing recalled', async () => {
  seed([entry('Move the commits to a new release branch')])
  const fake = embedder()
  fake.failing = true
  expect((await recall({}, fake)).hits).toEqual([])
})
