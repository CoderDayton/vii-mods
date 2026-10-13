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

test('a hit from the session asking says so on its first line, before its title', () => {
  const [head] = formatHits([hit({ own: true, title: 'Button labels' })], [], { maxChars: 2000 }).split('\n')
  expect(head).toBe('2026-10-09  claude-mods  d18dbf28  this session, earlier  Button labels')
})

const ASKED = 'The buttons show double brackets.'
const ENDED = 'The labels held brackets of their own; fixed.'

const lines = (extra: Parameters<typeof hit>[0]): string[] => formatHits([hit(extra)], [], { maxChars: 2000 }).split('\n').slice(1)

test('a match is shown inside its turn: the prompt before it, how the turn ended and what the user said next', () => {
  const entries = [{ id: 5, kind: 'cmd' as const, text: 'bun test tests/ui.test.tsx', score: 0.9, turn: 3, asked: ASKED, ended: ENDED, reply: 'commit' }]
  expect(lines({ entries, files: ['/work/app/src/ui.tsx', '/work/app/tests/ui.test.tsx'] })).toEqual([
    '  changed   src/ui.tsx, tests/ui.test.tsx',
    `  asked     ${ASKED}`,
    '  cmd       bun test tests/ui.test.tsx',
    `  ended     ${ENDED}`,
    '  reply     commit',
  ])
})

test('matches of one turn share its prompt and its end, in the order they happened', () => {
  const turn = { turn: 3, asked: ASKED, ended: ENDED, reply: 'commit' }
  const entries = [
    { id: 9, kind: 'edit' as const, text: '/work/app/src/ui.tsx\n- [ close ]\n+ close', score: 0.9, ...turn },
    { id: 5, kind: 'cmd' as const, text: 'bun test tests/ui.test.tsx', score: 0.8, ...turn },
  ]
  expect(lines({ entries })).toEqual([
    `  asked     ${ASKED}`,
    '  cmd       bun test tests/ui.test.tsx',
    '  edit      /work/app/src/ui.tsx - [ close ] + close',
    `  ended     ${ENDED}`,
    '  reply     commit',
  ])
})

test('turns of one session run oldest first, and no text is shown twice', () => {
  const entries = [
    { id: 20, kind: 'assistant' as const, text: 'Renamed the flag.', score: 0.9, turn: 18, asked: 'Now rename the flag.', ended: 'Renamed the flag.' },
    { id: 3, kind: 'user' as const, text: ASKED, score: 0.8, turn: 3, ended: ENDED, reply: 'Now rename the flag.' },
  ]
  expect(lines({ entries })).toEqual([`  user      ${ASKED}`, `  ended     ${ENDED}`, '  reply     Now rename the flag.', '  assistant Renamed the flag.'])
})

test('no hits say so, and a long list is cut to the size asked', () => {
  expect(formatHits([], [], { maxChars: 2000 })).toBe('No past session matches.')
  const many = Array.from({ length: 30 }, (_, i) => hit({ session: `session-${i}-aaaaaaaa` }))
  const text = formatHits(many, [], { maxChars: 600 })
  expect(text.length).toBeLessThanOrEqual(600)
  expect(text).toContain('more')
})

test('sessions beyond the page are counted, and the line names the offset that goes on', () => {
  const page = [hit(), hit({ session: 'aaaaaaaa-2' })]
  const text = formatHits(page, [], { maxChars: 4000, offset: 4, more: 7 })
  expect(text.endsWith('… 7 more sessions; go on with offset 6')).toBe(true)
  expect(formatHits(page, [], { maxChars: 4000, offset: 4, more: 0 })).not.toContain('more')
})

test('a page cut for size goes on from the last session shown', () => {
  const many = Array.from({ length: 10 }, (_, i) => hit({ session: `session-${i}-aaaaaaaa` }))
  const text = formatHits(many, [], { maxChars: 500, offset: 0, more: 3 })
  const shown = text.split('\n').filter(l => l.startsWith('2026-')).length
  expect(text).toContain(`${10 - shown + 3} more sessions; go on with offset ${shown}`)
})

test('a page past the last session says there is nothing further', () => {
  expect(formatHits([], [], { maxChars: 2000, offset: 5, more: 0 })).toBe('No more sessions match.')
})

test('a session with a title shows it at the end of its first line', () => {
  const [head] = formatHits([hit({ title: 'Fix the doubled brackets' })], [], { maxChars: 4000 }).split('\n')
  expect(head).toBe('2026-10-09  claude-mods  d18dbf28  Fix the doubled brackets')
})
