import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

test('defaults: auto launcher, no extra arguments, 30 quiet minutes, a minute to wait', () => {
  expect(readOptions({})).toEqual({ launcher: 'auto', claudeArgs: '', quietMs: 30 * 60_000, waitMs: 60_000 })
})

test('a named launcher and arguments are kept, an unknown launcher is auto', () => {
  expect(readOptions({ launcher: 'tmux', claudeArgs: ' --model opus ' })).toMatchObject({ launcher: 'tmux', claudeArgs: '--model opus' })
  expect(readOptions({ launcher: ' WezTerm ' }).launcher).toBe('wezterm')
  expect(readOptions({ launcher: 'kitty' }).launcher).toBe('auto')
})

test('quiet minutes are clamped to 5 through 600', () => {
  expect(readOptions({ quietMinutes: 1 }).quietMs).toBe(5 * 60_000)
  expect(readOptions({ quietMinutes: 9999 }).quietMs).toBe(600 * 60_000)
  expect(readOptions({ quietMinutes: 'x' }).quietMs).toBe(30 * 60_000)
})
