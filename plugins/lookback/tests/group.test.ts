import { expect, test } from 'claude-code/testing'

import { groupBySession } from '../src/core/search/group'
import type { StoredEntry } from '../src/core/types'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-11T00:00:00Z')

const entry = (id: number, session: string, extra: Partial<StoredEntry> = {}): StoredEntry => ({
  id,
  session,
  project: '/work/app',
  kind: 'assistant',
  text: `entry ${id}`,
  ts: NOW - DAY,
  ...extra,
})

const options = { now: NOW, limit: 5, perSession: 2, halfLifeDays: 90 }

test('entries of one session become one hit, best entry first', () => {
  const entries = [entry(1, 'a'), entry(2, 'a'), entry(3, 'b')]
  const fused = [{ id: 2, score: 0.03 }, { id: 3, score: 0.02 }, { id: 1, score: 0.01 }]
  const hits = groupBySession(fused, entries, options)
  expect(hits.map(h => h.session)).toEqual(['a', 'b'])
  expect(hits[0]!.entries.map(e => e.id)).toEqual([2, 1])
})

test('a session shows at most the entries asked for', () => {
  const entries = [1, 2, 3, 4].map(id => entry(id, 'a'))
  const fused = entries.map((e, i) => ({ id: e.id, score: 1 / (i + 1) }))
  expect(groupBySession(fused, entries, options)[0]!.entries).toHaveLength(2)
})

test('an entry that repeats the text of one already shown for the session is left out', () => {
  const entries = [entry(1, 'a', { text: 'Traceback: No module named PIL' }), entry(2, 'a', { text: '  traceback: no module named pil ' }), entry(3, 'a', { text: 'A different line' })]
  const fused = [{ id: 1, score: 0.03 }, { id: 2, score: 0.02 }, { id: 3, score: 0.01 }]
  expect(groupBySession(fused, entries, options)[0]!.entries.map(e => e.id)).toEqual([1, 3])
})

test('of two equal matches the newer session leads', () => {
  const entries = [entry(1, 'old', { ts: NOW - 400 * DAY }), entry(2, 'new', { ts: NOW - 2 * DAY })]
  const fused = [{ id: 1, score: 0.03 }, { id: 2, score: 0.03 }]
  expect(groupBySession(fused, entries, options).map(h => h.session)).toEqual(['new', 'old'])
})

test('a prompt or an error outweighs a shell command of the same rank', () => {
  const entries = [entry(1, 'cmd', { kind: 'cmd' }), entry(2, 'prompt', { kind: 'user' })]
  const fused = [{ id: 1, score: 0.03 }, { id: 2, score: 0.03 }]
  expect(groupBySession(fused, entries, options).map(h => h.session)).toEqual(['prompt', 'cmd'])
})

test('the list is cut at the limit, and ids with no entry are skipped', () => {
  const entries = [entry(1, 'a'), entry(2, 'b'), entry(3, 'c')]
  const fused = [{ id: 99, score: 1 }, { id: 1, score: 0.3 }, { id: 2, score: 0.2 }, { id: 3, score: 0.1 }]
  expect(groupBySession(fused, entries, { ...options, limit: 2 }).map(h => h.session)).toEqual(['a', 'b'])
})
