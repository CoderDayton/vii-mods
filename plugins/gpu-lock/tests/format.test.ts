import { expect, test } from 'claude-code/testing'

import { bar, clean, duration, gib, shortId } from '../src/format'

test('gib shows one decimal', () => {
  expect(gib(5589)).toBe('5.5 GiB')
  expect(gib(24564)).toBe('24.0 GiB')
  expect(gib(0)).toBe('0.0 GiB')
  expect(gib(512)).toBe('0.5 GiB')
})

test('duration reads in the largest fitting unit', () => {
  expect(duration(-5)).toBe('0s')
  expect(duration(400)).toBe('0s')
  expect(duration(42_000)).toBe('42s')
  expect(duration(192_000)).toBe('3m 12s')
  expect(duration(185_000)).toBe('3m 05s')
  expect(duration(3_900_000)).toBe('1h 05m')
  expect(duration(90_000_000)).toBe('1d 1h')
})

test('bar fills in proportion and clamps', () => {
  expect(bar(5589, 24564, 10)).toBe('██░░░░░░░░')
  expect(bar(0, 24564, 10)).toBe('░░░░░░░░░░')
  expect(bar(24564, 24564, 10)).toBe('██████████')
  expect(bar(99999, 24564, 10)).toBe('██████████')
  expect(bar(-5, 24564, 10)).toBe('░░░░░░░░░░')
  expect(bar(5, 0, 4)).toBe('░░░░')
})

test('clean collapses whitespace, drops control characters and clips', () => {
  expect(clean('a\nb\t  c\u0007\u001b[31m', 40)).toBe('a b c[31m')
  expect(clean('abcdefghij', 6)).toBe('abcde…')
  expect(clean('abc', 6)).toBe('abc')
  expect(clean('  ', 6)).toBe('')
})

test('shortId keeps the first four characters', () => {
  expect(shortId('7f3a9c12-aaaa')).toBe('7f3a')
  expect(shortId('ab')).toBe('ab')
})
