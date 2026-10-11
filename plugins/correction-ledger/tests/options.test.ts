import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

const LIVES = { task: 2, project: 14 }

test('the defaults are haiku, twelve rules, fifteen seconds, two days for a task rule and fourteen for a project rule', () => {
  expect(readOptions({})).toEqual({ model: 'haiku', maxRules: 12, timeoutMs: 15000, lives: LIVES })
})

test('the lives of rules are taken and kept in range', () => {
  expect(readOptions({ taskDays: 5, ruleDays: 30 }).lives).toEqual({ task: 5, project: 30 })
  expect(readOptions({ taskDays: 0, ruleDays: 1 }).lives).toEqual({ task: 1, project: 3 })
  expect(readOptions({ taskDays: 999, ruleDays: 999 }).lives).toEqual({ task: 14, project: 90 })
})

test('values from the options are taken and kept in range', () => {
  expect(readOptions({ model: ' sonnet ', maxRules: 20, timeoutSeconds: 30 })).toEqual({ model: 'sonnet', maxRules: 20, timeoutMs: 30000, lives: LIVES })
  expect(readOptions({ maxRules: 1 }).maxRules).toBe(3)
  expect(readOptions({ maxRules: 999 }).maxRules).toBe(30)
  expect(readOptions({ timeoutSeconds: 0 }).timeoutMs).toBe(5000)
  expect(readOptions({ timeoutSeconds: 999 }).timeoutMs).toBe(60000)
})

test('a blank or wrong-typed value falls back', () => {
  expect(readOptions({ model: '  ', maxRules: 'many', timeoutSeconds: 'soon' })).toEqual({ model: 'haiku', maxRules: 12, timeoutMs: 15000, lives: LIVES })
})
