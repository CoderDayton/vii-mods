import { expect, test } from 'claude-code/testing'

import { groupBySession } from '../src/core/search/group'
import { DEFAULT_TUNING } from '../src/core/search/tuning'
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

test('a session shows what was said beside the code that matched, not two lines of code', () => {
  const entries = [entry(1, 'a', { kind: 'edit' }), entry(2, 'a', { kind: 'edit' }), entry(3, 'a', { kind: 'cmd' }), entry(4, 'a', { kind: 'assistant' })]
  const fused = [{ id: 1, score: 0.9 }, { id: 2, score: 0.8 }, { id: 3, score: 0.7 }, { id: 4, score: 0.3 }]
  expect(groupBySession(fused, entries, options)[0]!.entries.map(e => e.id)).toEqual([1, 4])
})

test('a session where only code matched shows its two best lines of code', () => {
  const entries = [entry(1, 'a', { kind: 'edit' }), entry(2, 'a', { kind: 'cmd' }), entry(3, 'a', { kind: 'edit' })]
  const fused = [{ id: 1, score: 0.9 }, { id: 2, score: 0.6 }, { id: 3, score: 0.5 }]
  expect(groupBySession(fused, entries, options)[0]!.entries.map(e => e.id)).toEqual([1, 2])
})

test('a session far weaker than the best is left out, unless it holds a word of the question', () => {
  const entries = [entry(1, 'best'), entry(2, 'near'), entry(3, 'far')]
  const fused = [{ id: 1, score: 0.9 }, { id: 2, score: 0.5 }, { id: 3, score: 0.1 }]
  const tuning = { ...DEFAULT_TUNING, minShare: 0.4 }
  expect(groupBySession(fused, entries, { ...options, tuning }).map(h => h.session)).toEqual(['best', 'near'])
  expect(groupBySession([{ id: 3, score: 0.001 }], entries, { ...options, tuning }).map(h => h.session)).toEqual(['far'])
  expect(groupBySession(fused, entries, { ...options, tuning, worded: new Set([3]) }).map(h => h.session)).toEqual(['best', 'near', 'far'])
})

test('a session in a project the question names counts for more', () => {
  const entries = [entry(1, 'other', { project: '/work/api' }), entry(2, 'named', { project: '/work/glowseed-garden' })]
  const fused = [{ id: 1, score: 0.5 }, { id: 2, score: 0.48 }]
  const tuning = { ...DEFAULT_TUNING, projectBoost: 1.2 }
  expect(groupBySession(fused, entries, { ...options, tuning }).map(h => h.session)).toEqual(['other', 'named'])
  expect(groupBySession(fused, entries, { ...options, tuning, terms: ['frame', 'garden'] }).map(h => h.session)).toEqual(['named', 'other'])
  expect(groupBySession(fused, entries, { ...options, tuning, terms: ['gard'] }).map(h => h.session)).toEqual(['other', 'named'])
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
