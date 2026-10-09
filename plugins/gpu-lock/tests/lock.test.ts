import { expect, test } from 'claude-code/testing'

import { lockState, ownerPathOf, parseHolder } from '../src/lock'

const owner = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session: '7f3a9c12',
    agent: null,
    cmd: 'python train.py',
    cwd: '/work',
    why: 'python + train.py',
    needMiB: null,
    pid: 4242,
    since: 1_700_000_000,
    ...extra,
  })

test('the owner file sits beside the lock file', () => {
  expect(ownerPathOf('/tmp/gpu-lock/lock')).toBe('/tmp/gpu-lock/owner.json')
  expect(ownerPathOf('lock')).toBe('./owner.json')
})

test('parses an owner file; since is seconds in the file and ms after', () => {
  const h = parseHolder(owner())
  expect(h).toEqual({
    session: '7f3a9c12',
    agent: null,
    cmd: 'python train.py',
    cwd: '/work',
    why: 'python + train.py',
    needMiB: null,
    pid: 4242,
    since: 1_700_000_000_000,
  })
})

test('rejects owner text that is not valid or is missing the pid or since', () => {
  expect(parseHolder('')).toBe(null)
  expect(parseHolder('not json')).toBe(null)
  expect(parseHolder('[]')).toBe(null)
  expect(parseHolder(owner({ pid: undefined }))).toBe(null)
  expect(parseHolder(owner({ since: 'now' }))).toBe(null)
  expect(parseHolder(owner({ pid: -3 }))).toBe(null)
})

test('owner text is untrusted: control characters go and long text is clipped', () => {
  const h = parseHolder(owner({ cmd: `echo\n${'x'.repeat(500)}\u0007`, session: 's'.repeat(300) }))
  expect(h?.cmd.includes('\n')).toBe(false)
  expect((h?.cmd.length ?? 0) <= 200).toBe(true)
  expect((h?.session.length ?? 0) <= 64).toBe(true)
})

test('a wrong-typed field falls back instead of throwing', () => {
  const h = parseHolder(owner({ cmd: 5, agent: 7, needMiB: 'lots' }))
  expect(h?.cmd).toBe('')
  expect(h?.agent).toBe(null)
  expect(h?.needMiB).toBe(null)
})

test('probe exit 1 is free, 0 is held, anything else is unavailable', () => {
  expect(lockState(1, null, true)).toEqual({ kind: 'free' })
  expect(lockState(3, null, true).kind).toBe('unavailable')
  expect(lockState(127, null, true).kind).toBe('unavailable')
})

test('held with a live owner names the holder', () => {
  const s = lockState(0, owner(), true)
  expect(s.kind).toBe('held')
  expect(s.kind === 'held' && s.holder?.cmd).toBe('python train.py')
})

test('held with a dead owner pid, or no owner file, is held by an unknown process', () => {
  const dead = lockState(0, owner(), false)
  expect(dead).toEqual({ kind: 'held', holder: null })
  expect(lockState(0, null, true)).toEqual({ kind: 'held', holder: null })
  expect(lockState(0, 'garbage', true)).toEqual({ kind: 'held', holder: null })
})
