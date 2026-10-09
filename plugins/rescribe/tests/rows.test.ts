import { expect, test } from 'claude-code/testing'

import type { Review } from '../types'
import { paneRows, reviewModel } from '../src/view'
import type { Row } from '../src/view'

const review = (original: string, fixed: string, pairs: Review['pairs'] = [{ heard: 'x', meant: 'y' }]): Review => ({
  original,
  fixed,
  pairs,
})

const text = (row: Row): string => row.segs.map(s => s.text).join('')
const kinds = (rows: readonly Row[]): string[] => rows.map(r => r.kind)

test('a one-line change is one removed row above one added row', () => {
  const m = reviewModel(review('clear the cash now', 'clear the cache now'))
  expect(kinds(m.rows)).toEqual(['del', 'ins'])
  expect(text(m.rows[0] as Row)).toBe('clear the cash now')
  expect(text(m.rows[1] as Row)).toBe('clear the cache now')
})

test('a pane wants one row per short line and one more per hundred characters of a long one', () => {
  expect(paneRows(reviewModel(review('clear the cash now', 'clear the cache now')).rows)).toBe(2)
  const long = `${'word '.repeat(50)}cash`
  const m = reviewModel(review(long, long.replace('cash', 'cache')))
  expect(paneRows(m.rows)).toBe(6)
  expect(paneRows([])).toBe(1)
})

test('only the changed word is marked on each row', () => {
  const m = reviewModel(review('clear the cash now', 'clear the cache now'))
  expect((m.rows[0] as Row).segs.filter(s => s.isChanged).map(s => s.text)).toEqual(['cash'])
  expect((m.rows[1] as Row).segs.filter(s => s.isChanged).map(s => s.text)).toEqual(['cache'])
})

test('the header counts the changes and says how the length moved', () => {
  const one = reviewModel(review('clear the cash now', 'clear the cache now', [{ heard: 'cash', meant: 'cache' }]))
  expect(one.count).toBe('1 change')
  expect(one.size).toBe('18 → 19 chars')
  const two = reviewModel(
    review('a', 'b', [
      { heard: 'a', meant: 'b' },
      { heard: 'c', meant: 'd' },
    ]),
  )
  expect(two.count).toBe('2 changes')
})

test('a rewrite that changes no word says so instead of counting zero changes', () => {
  const m = reviewModel(review('fix the login, then the logout', 'fix the login. then the logout!', []))
  expect(m.count).toBe('no word changes')
  expect(kinds(m.rows)).toEqual(['del', 'ins'])
})

test('unchanged lines around a change are shown as context', () => {
  const m = reviewModel(review('one\ntwo cash\nthree', 'one\ntwo cache\nthree'))
  expect(kinds(m.rows)).toEqual(['ctx', 'del', 'ins', 'ctx'])
  expect(text(m.rows[0] as Row)).toBe('one')
  expect(text(m.rows[3] as Row)).toBe('three')
})

test('a long run of unchanged lines folds to one row with its count, keeping one line next to the change', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
  const fixed = lines.map((l, i) => (i === 5 ? 'line 5 changed' : l)).join('\n')
  const m = reviewModel(review(lines.join('\n'), fixed))
  expect(kinds(m.rows)).toEqual(['fold', 'ctx', 'del', 'ins', 'ctx', 'fold'])
  expect((m.rows[0] as Row).skipped).toBe(4)
  expect(text(m.rows[1] as Row)).toBe('line 4')
  expect(text(m.rows[4] as Row)).toBe('line 6')
  expect((m.rows[5] as Row).skipped).toBe(3)
})

test('a short run of unchanged lines between two changes is shown whole', () => {
  const m = reviewModel(review('a1\nkeep one\nkeep two\na2', 'b1\nkeep one\nkeep two\nb2'))
  expect(kinds(m.rows)).toEqual(['del', 'ins', 'ctx', 'ctx', 'del', 'ins'])
})

test('a long run between two changes folds its middle', () => {
  const mid = Array.from({ length: 8 }, (_, i) => `mid ${i}`)
  const m = reviewModel(review(['a1', ...mid, 'a2'].join('\n'), ['b1', ...mid, 'b2'].join('\n')))
  expect(kinds(m.rows)).toEqual(['del', 'ins', 'ctx', 'fold', 'ctx', 'del', 'ins'])
  expect((m.rows[3] as Row).skipped).toBe(6)
})

test('an added line has no removed row, and a removed line has no added row', () => {
  expect(kinds(reviewModel(review('a\nb', 'a\nx\nb')).rows)).toEqual(['ctx', 'ins', 'ctx'])
  expect(kinds(reviewModel(review('a\nx\nb', 'a\nb')).rows)).toEqual(['ctx', 'del', 'ctx'])
})

test('a blank line is kept as an empty row', () => {
  const m = reviewModel(review('a\n\nb cash', 'a\n\nb cache'))
  expect(kinds(m.rows)).toEqual(['ctx', 'ctx', 'del', 'ins'])
  expect(text(m.rows[1] as Row)).toBe('')
})

test('surrounding whitespace is ignored', () => {
  const m = reviewModel(review('  clear the cash  \n', 'clear the cache'))
  expect(kinds(m.rows)).toEqual(['del', 'ins'])
  expect(text(m.rows[0] as Row)).toBe('clear the cash')
})

test('an unchanged draft has no rows', () => {
  expect(reviewModel(review('same', 'same')).rows).toEqual([])
})
