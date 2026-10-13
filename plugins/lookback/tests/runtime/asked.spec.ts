import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { recallAsked } from '../../src/runtime/asked'
import { Store } from '../../src/runtime/store/store'
import type { Entry } from '../../src/core/types'
import { FakeEmbedder, tempDir } from './helpers'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-11T12:00:00Z')
const PROMPT = 'did you rebuild it?'

let tmp: ReturnType<typeof tempDir>
let store: Store

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({ kind: 'assistant', text, ts: NOW - 5 * HOUR, session: 'me', project: '/work/app', ...extra })

// The exchange just before the question, which names the topic.
const LAST_EXCHANGE = [
  entry('now check the blueprint for the garden gate', { kind: 'user', ts: NOW - 600_000 }),
  entry('The garden gate blueprint has a hinge on the wrong side. The blueprint needs one more pass.', { ts: NOW - 500_000 }),
]

// Entries about other things, so that no word of the test is a common one, and three for each topic word,
// so that none of them is a one-off.
const seed = (entries: Entry[]): void => {
  store.useVectors({ model: 'fake', dimension: 32 })
  store.addEntries(Array.from({ length: 400 }, (_, i) => entry(`Unrelated note number ${i} about something else`, { session: 'filler', project: '/work/other' })))
  const words = ['garden', 'gate', 'blueprint', 'hinge', 'rebuild']
  store.addEntries(words.flatMap(word => Array.from({ length: 3 }, (_, i) => entry(`A lone remark ${i} that holds the word ${word}`, { session: 'words', project: '/work/other' }))))
  store.addEntries([...LAST_EXCHANGE, ...entries])
}

const recall = (extra: Partial<Parameters<typeof recallAsked>[3]> = {}, embedder: FakeEmbedder | null = null, prompt = PROMPT) =>
  recallAsked(store, embedder, prompt, { now: NOW, session: 'me', ...extra })

beforeEach(() => {
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  tmp.remove()
})

test('a short question is answered by what Claude said earlier in this session', async () => {
  seed([entry('Rebuilt the garden gate blueprint and installed it.')])
  const { hits } = await recall()
  expect(hits[0]).toMatchObject({ session: 'me', own: true })
  expect(hits[0]?.entries[0]?.text).toContain('Rebuilt the garden gate blueprint')
})

test('the exchange just before the question is left out, as it would match its own words', async () => {
  seed([entry('The garden gate blueprint was rebuilt last week.', { session: 'other' })])
  const { hits } = await recall()
  expect(hits.map(h => h.session)).toEqual(['other'])
  expect(hits[0]?.own).toBeUndefined()
})

test('this session comes before another one that says the same', async () => {
  seed([entry('The garden gate blueprint was rebuilt.', { session: 'other' }), entry('The garden gate blueprint was rebuilt.')])
  expect((await recall()).hits.map(h => h.session)).toEqual(['me', 'other'])
})

test('what Claude said ranks above a prompt of the user that says the same', async () => {
  seed([
    entry('rebuild the garden gate blueprint', { kind: 'user', session: 'asked' }),
    entry('Rebuilt the garden gate blueprint.', { session: 'answered' }),
  ])
  expect((await recall()).hits.map(h => h.session)).toEqual(['answered', 'asked'])
})

test('an entry that shares one word with the question and nothing with its topic is not shown', async () => {
  seed([entry('Rebuild the docker image before the deploy.', { session: 'other' })])
  expect((await recall()).hits).toEqual([])
})

test('nothing said after the question is recalled', async () => {
  seed([entry('Rebuilt the garden gate blueprint.', { session: 'later', ts: NOW + HOUR })])
  expect((await recall()).hits).toEqual([])
})

test('at most two sessions come back', async () => {
  seed(['a', 'b', 'c'].map(session => entry('Rebuilt the garden gate blueprint.', { session })))
  expect((await recall()).hits).toHaveLength(2)
})

test('a question with no word that tells entries apart, in a session that said nothing yet, recalls nothing', async () => {
  store.useVectors({ model: 'fake', dimension: 32 })
  store.addEntries(Array.from({ length: 80 }, (_, i) => entry(`Unrelated note number ${i}: what did you do`, { session: 'filler' })))
  expect((await recall({}, null, 'what did you do?')).hits).toEqual([])
})

test('an embedding server that does not answer leaves the match on words', async () => {
  seed([entry('Rebuilt the garden gate blueprint and installed it.')])
  const embedder = new FakeEmbedder()
  embedder.failing = true
  expect((await recall({}, embedder)).hits[0]?.session).toBe('me')
})
