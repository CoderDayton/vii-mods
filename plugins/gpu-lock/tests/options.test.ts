import { expect, test } from 'claude-code/testing'

import { DEFAULT_LOCK_PATH, readOptions } from '../src/options'

test('empty options give the defaults', () => {
  const c = readOptions({})
  expect(c.waitSeconds).toBe(0)
  expect(c.minFreeMiB).toBe(1024)
  expect(c.band).toBe('auto')
  expect(c.lockPath).toBe(DEFAULT_LOCK_PATH)
  expect(c.extra).toEqual([])
  expect(c.skip).toEqual([])
  expect(c.bad).toEqual([])
})

test('numbers are whole and clamped', () => {
  expect(readOptions({ waitSeconds: 9999 }).waitSeconds).toBe(600)
  expect(readOptions({ waitSeconds: -5 }).waitSeconds).toBe(0)
  expect(readOptions({ waitSeconds: 2.7 }).waitSeconds).toBe(2)
  expect(readOptions({ waitSeconds: Number.NaN }).waitSeconds).toBe(0)
  expect(readOptions({ waitSeconds: '30' }).waitSeconds).toBe(0)
  expect(readOptions({ minFreeMiB: -1 }).minFreeMiB).toBe(0)
  expect(readOptions({ minFreeMiB: 2048.9 }).minFreeMiB).toBe(2048)
})

test('band must be one of the three words', () => {
  expect(readOptions({ band: 'always' }).band).toBe('always')
  expect(readOptions({ band: 'never' }).band).toBe('never')
  expect(readOptions({ band: 'loud' }).band).toBe('auto')
  expect(readOptions({ band: 3 }).band).toBe('auto')
})

test('the lock path must be absolute and free of newlines and quotes', () => {
  expect(readOptions({ lockPath: '/var/run/gpu/lock' }).lockPath).toBe('/var/run/gpu/lock')
  expect(readOptions({ lockPath: 'relative/lock' }).lockPath).toBe(DEFAULT_LOCK_PATH)
  expect(readOptions({ lockPath: '' }).lockPath).toBe(DEFAULT_LOCK_PATH)
  expect(readOptions({ lockPath: '/tmp/a\nb' }).lockPath).toBe(DEFAULT_LOCK_PATH)
  expect(readOptions({ lockPath: 'a' }).lockPath).toBe(DEFAULT_LOCK_PATH)
})

test('patterns compile, and bad ones from both fields are reported', () => {
  const c = readOptions({ extraPatterns: 'one\n(bad', skipPatterns: 'two\n[bad' })
  expect(c.extra.length).toBe(1)
  expect(c.skip.length).toBe(1)
  expect(c.bad).toEqual(['(bad', '[bad'])
})
