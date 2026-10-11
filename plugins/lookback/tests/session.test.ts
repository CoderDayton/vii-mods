import { expect, test } from 'claude-code/testing'

import { formatSession, formatSessionList } from '../src/core/search/session'
import type { SessionSummary } from '../src/core/types'

const T0 = Date.parse('2026-10-09T10:00:00Z')

const summary: SessionSummary = { session: 'd18dbf28-1111-2222-3333-444444444444', project: '/home/u/work/claude-mods', first: T0, last: T0 + 3_600_000, entries: 3 }

const entries = [
  { id: 1, kind: 'user' as const, text: 'The buttons show double brackets.', ts: T0, session: summary.session, project: summary.project },
  { id: 2, kind: 'cmd' as const, text: 'bun test', ts: T0 + 60_000, session: summary.session, project: summary.project },
  { id: 3, kind: 'assistant' as const, text: 'Fixed: the labels are plain now.', ts: T0 + 120_000, session: summary.session, project: summary.project },
]

test('a session shows its full id, project, dates and every entry in order with its time and kind', () => {
  const text = formatSession(summary, entries, { offset: 0, maxChars: 4000, entryChars: 400 })
  const lines = text.split('\n')
  expect(lines[0]).toContain('d18dbf28-1111-2222-3333-444444444444')
  expect(lines[0]).toContain('claude-mods')
  expect(lines[0]).toContain('2026-10-09')
  expect(lines[0]).toContain('3 entries')
  expect(lines.slice(1)).toEqual(['10:00 user      The buttons show double brackets.', '10:01 cmd       bun test', '10:02 assistant Fixed: the labels are plain now.'])
})

test('a long entry is cut, and line breaks in it become spaces', () => {
  const long = [{ ...entries[0]!, text: `first line\nsecond ${'word '.repeat(200)}` }]
  const text = formatSession({ ...summary, entries: 1 }, long, { offset: 0, maxChars: 4000, entryChars: 60 })
  expect(text.split('\n')[1]!.length).toBeLessThanOrEqual(16 + 61)
  expect(text).toContain('first line second')
  expect(text).toContain('…')
})

test('entries left out say how to see them', () => {
  const text = formatSession({ ...summary, entries: 50 }, entries, { offset: 10, maxChars: 4000, entryChars: 400 })
  expect(text).toContain('entries 11 to 13 of 50')
  expect(text).toContain('offset 13')
})

test('a session cut to the size asked says where to go on', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...entries[2]!, id: i + 1, text: `answer number ${i} `.repeat(4) }))
  const text = formatSession({ ...summary, entries: 40 }, many, { offset: 0, maxChars: 700, entryChars: 400 })
  expect(text.length).toBeLessThanOrEqual(700)
  const shown = text.split('\n').filter(l => l.includes('assistant')).length
  expect(shown).toBeGreaterThan(0)
  expect(text).toContain(`offset ${shown}`)
})

test('several sessions are listed one per line with the full id', () => {
  const other = { ...summary, session: 'd18dffff-0000-0000-0000-000000000000', entries: 9 }
  const text = formatSessionList([summary, other])
  expect(text.split('\n')).toHaveLength(2)
  expect(text).toContain('d18dffff-0000-0000-0000-000000000000')
  expect(text).toContain('9 entries')
})
