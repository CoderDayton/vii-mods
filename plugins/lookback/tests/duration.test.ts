import { expect, test } from 'claude-code/testing'

import { durationMs } from '../src/core/text/duration'

test('hours, days and weeks are read', () => {
  expect(durationMs('12h')).toBe(12 * 3_600_000)
  expect(durationMs('30d')).toBe(30 * 86_400_000)
  expect(durationMs('2w')).toBe(14 * 86_400_000)
})

test('anything else is not a duration', () => {
  for (const bad of ['', 'soon', '10', '1.5d', '-3d', '5 days', '0d']) expect(durationMs(bad)).toBeNull()
})
