import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

test('the default is 30 quiet minutes', () => {
  expect(readOptions({})).toEqual({ quietMs: 30 * 60_000 })
})

test('quiet minutes are clamped to 5 through 600', () => {
  expect(readOptions({ quietMinutes: 1 }).quietMs).toBe(5 * 60_000)
  expect(readOptions({ quietMinutes: 9999 }).quietMs).toBe(600 * 60_000)
  expect(readOptions({ quietMinutes: 'x' }).quietMs).toBe(30 * 60_000)
})
