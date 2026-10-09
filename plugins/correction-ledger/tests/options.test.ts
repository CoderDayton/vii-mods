import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

test('the defaults are haiku, twelve rules and fifteen seconds', () => {
  expect(readOptions({})).toEqual({ model: 'haiku', maxRules: 12, timeoutMs: 15000 })
})

test('values from the options are taken and kept in range', () => {
  expect(readOptions({ model: ' sonnet ', maxRules: 20, timeoutSeconds: 30 })).toEqual({ model: 'sonnet', maxRules: 20, timeoutMs: 30000 })
  expect(readOptions({ maxRules: 1 }).maxRules).toBe(3)
  expect(readOptions({ maxRules: 999 }).maxRules).toBe(30)
  expect(readOptions({ timeoutSeconds: 0 }).timeoutMs).toBe(5000)
  expect(readOptions({ timeoutSeconds: 999 }).timeoutMs).toBe(60000)
})

test('a blank or wrong-typed value falls back', () => {
  expect(readOptions({ model: '  ', maxRules: 'many', timeoutSeconds: 'soon' })).toEqual({ model: 'haiku', maxRules: 12, timeoutMs: 15000 })
})
