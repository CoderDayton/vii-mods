import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

test('the defaults are three plain comments, docstrings allowed and no toasts', () => {
  expect(readOptions({})).toEqual({ max: 3, allowDocs: true, notify: false })
})

test('values are taken and the limit is kept in range', () => {
  expect(readOptions({ maxPlain: 5, allowDocstrings: false, notify: true })).toEqual({ max: 5, allowDocs: false, notify: true })
  expect(readOptions({ maxPlain: -2 }).max).toBe(0)
  expect(readOptions({ maxPlain: 999 }).max).toBe(20)
})

test('a wrong-typed value falls back', () => {
  expect(readOptions({ maxPlain: 'few', allowDocstrings: 'no', notify: 'yes' })).toEqual({ max: 3, allowDocs: true, notify: false })
})
