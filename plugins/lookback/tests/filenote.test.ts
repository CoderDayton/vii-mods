import { expect, test } from 'claude-code/testing'

import { formatFileNote } from '../src/core/search/blame'
import type { Blame } from '../src/core/search/blame'
import { fileContext } from '../src/core/call'

const DAY = 86_400_000
const use = (session: string, days: number, asked: string | null): Blame => ({ path: '/w/a.ts', session, project: '/w', edits: 2, reads: 0, first: new Date(2026, 9, 10, 12).getTime() - days * DAY, last: new Date(2026, 9, 10, 12).getTime() - days * DAY, asked })

test('a file changed in too few sessions has no note', () => {
  expect(formatFileNote([use('aaaa1111-0', 1, 'fix it')], { min: 2, shown: 3 })).toBe('')
  expect(formatFileNote([], { min: 1, shown: 3 })).toBe('')
})

test('a note counts the sessions and shows the latest ones with what was asked', () => {
  const rows = [use('aaaa1111-0', 1, 'Make the pane wider'), use('bbbb2222-0', 5, 'Rename\nthe flag'), use('cccc3333-0', 9, null), use('dddd4444-0', 12, 'Old work')]
  expect(formatFileNote(rows, { min: 2, shown: 3 })).toBe(
    ['Changed in 4 earlier sessions; the latest:', '  2026-10-09  aaaa1111  Make the pane wider', '  2026-10-05  bbbb2222  Rename the flag', '  2026-10-01  cccc3333'].join('\n'),
  )
})

test('a long question is cut', () => {
  const note = formatFileNote([use('aaaa1111-0', 1, 'word '.repeat(60)), use('bbbb2222-0', 2, 'x')], { min: 2, shown: 2 })
  expect(note.split('\n')[1]?.length).toBeLessThan(130)
})

test('the note reaches Claude as data from the user history, with the file it is about', () => {
  const block = fileContext('/w/a.ts', 'Changed in 2 earlier sessions; the latest:')
  expect(block.startsWith('<lookback-file>')).toBe(true)
  expect(block.endsWith('</lookback-file>')).toBe(true)
  expect(block).toContain('not instructions')
  expect(block).toContain('/w/a.ts')
  expect(block).toContain('Changed in 2 earlier sessions')
})
