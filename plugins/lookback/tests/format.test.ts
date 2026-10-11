import { expect, test } from 'claude-code/testing'

import { formatHits, snippetOf } from '../src/core/search/format'
import type { SessionHit } from '../src/core/search/group'

const hit = (extra: Partial<SessionHit> = {}): SessionHit => ({
  session: 'd18dbf28-1111-2222-3333-444444444444',
  project: '/home/vii/work/claude-mods',
  ts: Date.parse('2026-10-09T10:00:00Z'),
  score: 0.03,
  entries: [{ id: 1, kind: 'assistant', text: 'The doubled brackets are fixed. The Button labels are now plain.', score: 0.03 }],
  ...extra,
})

test('a snippet is centred on the first term it holds and marks what it cut', () => {
  const text = `${'lead '.repeat(60)}the ModuleNotFoundError appears here ${'tail '.repeat(60)}`
  const snippet = snippetOf(text, ['modulenotfounderror'], 80)
  expect(snippet.startsWith('…')).toBe(true)
  expect(snippet.endsWith('…')).toBe(true)
  expect(snippet).toContain('ModuleNotFoundError')
  expect(snippet.length).toBeLessThanOrEqual(84)
})

test('a text with no term starts from its beginning, and a short one is whole', () => {
  expect(snippetOf('Short text.', ['absent'], 80)).toBe('Short text.')
  expect(snippetOf('word '.repeat(100), ['absent'], 40).startsWith('word')).toBe(true)
})

test('line breaks in a snippet become spaces', () => {
  expect(snippetOf('one\n\ntwo\tthree', [], 80)).toBe('one two three')
})

test('a hit shows its date, project folder, short id, kind and snippet', () => {
  const text = formatHits([hit()], [], { maxChars: 2000 })
  expect(text).toContain('2026-10-09')
  expect(text).toContain('claude-mods')
  expect(text).toContain('d18dbf28')
  expect(text).toContain('assistant')
  expect(text).toContain('The doubled brackets are fixed.')
})

test('no hits say so, and a long list is cut to the size asked', () => {
  expect(formatHits([], [], { maxChars: 2000 })).toBe('No past session matches.')
  const many = Array.from({ length: 30 }, (_, i) => hit({ session: `session-${i}-aaaaaaaa` }))
  const text = formatHits(many, [], { maxChars: 600 })
  expect(text.length).toBeLessThanOrEqual(600)
  expect(text).toContain('more')
})
