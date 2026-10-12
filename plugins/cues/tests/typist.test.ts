import { expect, test } from 'claude-code/testing'

import { Typist, keyDelay } from '../src/typist'

test('text comes back one character at a time, in order', () => {
  const t = new Typist()
  t.push('ab')
  expect(t.next()).toBe('a')
  expect(t.next()).toBe('b')
  expect(t.next()).toBeNull()
  expect(t.isEmpty).toBe(true)
})

test('a run of blanks is one keystroke', () => {
  const t = new Typist()
  t.push('a \n  b')
  expect([t.next(), t.next(), t.next(), t.next()]).toEqual(['a', ' ', 'b', null])
})

test('a backlog over the limit keeps only its newest characters', () => {
  const t = new Typist(4)
  t.push('abcdefgh')
  expect(t.next()).toBe('e')
})

test('keys come at an uneven pace, with a longer wait after a word', () => {
  expect(keyDelay('a', 0.5)).toBe(110)
  expect(keyDelay('a', 0)).toBe(77)
  expect(keyDelay('a', 1)).toBe(143)
  expect(keyDelay(' ', 0.5)).toBe(200)
  expect(keyDelay('\n', 0.5)).toBe(200)
})

test('clear drops what is waiting', () => {
  const t = new Typist()
  t.push('abc')
  t.clear()
  expect(t.next()).toBeNull()
})
