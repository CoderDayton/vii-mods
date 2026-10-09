import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/options'

test('the defaults are haiku on high effort, twenty seconds and auto accept', () => {
  expect(readOptions({})).toEqual({ model: 'haiku', effort: 'high', timeoutMs: 20000, autoAccept: true })
})

test('a model name, an effort and a timeout are taken from the options', () => {
  expect(readOptions({ model: ' sonnet ', effort: 'medium', timeoutSeconds: 45 })).toEqual({
    model: 'sonnet',
    effort: 'medium',
    timeoutMs: 45000,
    autoAccept: true,
  })
})

test('auto accept is off only for the boolean false', () => {
  expect(readOptions({ autoAccept: false }).autoAccept).toBe(false)
  expect(readOptions({ autoAccept: true }).autoAccept).toBe(true)
  expect(readOptions({ autoAccept: 'false' }).autoAccept).toBe(true)
  expect(readOptions({ autoAccept: 0 }).autoAccept).toBe(true)
})

test('a blank or non-text model falls back, and the timeout is kept in range', () => {
  expect(readOptions({ model: '   ' }).model).toBe('haiku')
  expect(readOptions({ model: 7 }).model).toBe('haiku')
  expect(readOptions({ timeoutSeconds: 0 }).timeoutMs).toBe(5000)
  expect(readOptions({ timeoutSeconds: 9999 }).timeoutMs).toBe(120000)
  expect(readOptions({ timeoutSeconds: 'soon' }).timeoutMs).toBe(20000)
})

test('every effort level is accepted, any other value falls back to high', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    expect(readOptions({ effort: level }).effort).toBe(level)
  }
  expect(readOptions({ effort: 'LOW ' }).effort).toBe('low')
  expect(readOptions({ effort: 'fast' }).effort).toBe('high')
  expect(readOptions({ effort: 3 }).effort).toBe('high')
})
