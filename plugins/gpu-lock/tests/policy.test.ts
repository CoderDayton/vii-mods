import { expect, test } from 'claude-code/testing'

import type { Verdict } from '../src/classify'
import { decide } from '../src/policy'
import type { Holder, LockState, Reading } from '../types'

const gpuJob = (extra: { needMiB?: number | null; devices?: number[] | null } = {}): Verdict => ({
  gpu: true,
  why: 'python + train.py',
  needMiB: extra.needMiB ?? null,
  devices: extra.devices ?? null,
})

const holder: Holder = {
  session: 's1',
  agent: null,
  cmd: 'python train.py',
  cwd: '/w',
  why: 'x',
  needMiB: null,
  pid: 1,
  since: 1,
}

const free: LockState = { kind: 'free' }
const held: LockState = { kind: 'held', holder }

const card = (usedMiB: number, index = 0, totalMiB = 24000): Reading => ({
  kind: 'ok',
  gpus: [{ index, name: 'RTX', usedMiB, totalMiB, util: 0, tempC: 40 }],
  apps: [],
})

const base = { minFreeMiB: 1024, waitSeconds: 0, mode: 'exclusive' as const, maxPercent: 75, now: 1_000_000, waiters: [] }

test('a command that is not a GPU job passes untouched', () => {
  const d = decide({ ...base, verdict: { gpu: false }, lock: held, gpu: card(23000) })
  expect(d).toEqual({ kind: 'pass', reason: 'not-gpu' })
})

test('a GPU job passes unwrapped when the lock cannot work', () => {
  const d = decide({ ...base, verdict: gpuJob(), lock: { kind: 'unavailable', reason: 'x' }, gpu: card(100) })
  expect(d).toEqual({ kind: 'pass', reason: 'unavailable' })
})

test('a held lock refuses at once when the wait is 0', () => {
  const d = decide({ ...base, verdict: gpuJob(), lock: held, gpu: card(100) })
  expect(d).toEqual({ kind: 'refuse-busy', holders: [holder] })
})

test('a held lock with an unknown holder refuses too', () => {
  const d = decide({ ...base, verdict: gpuJob(), lock: { kind: 'held', holder: null }, gpu: card(100) })
  expect(d).toEqual({ kind: 'refuse-busy', holders: [] })
})

test('a held lock with a wait queues, and skips the memory check for now', () => {
  const d = decide({ ...base, waitSeconds: 30, verdict: gpuJob(), lock: held, gpu: card(23900) })
  expect(d).toEqual({ kind: 'run', waits: true, freeMiB: null, totalMiB: null })
})

test('a free lock with enough memory runs, and reports headroom', () => {
  const d = decide({ ...base, verdict: gpuJob(), lock: free, gpu: card(5000) })
  expect(d).toEqual({ kind: 'run', waits: false, freeMiB: 19000, totalMiB: 24000 })
})

test('less free memory than the floor refuses', () => {
  const d = decide({ ...base, verdict: gpuJob(), lock: free, gpu: card(23500) })
  expect(d).toEqual({ kind: 'refuse-memory', needMiB: 1024, freeMiB: 500, totalMiB: 24000 })
})

test('a declared need replaces the floor, higher or lower', () => {
  const high = decide({ ...base, verdict: gpuJob({ needMiB: 8192 }), lock: free, gpu: card(20000) })
  expect(high).toEqual({ kind: 'refuse-memory', needMiB: 8192, freeMiB: 4000, totalMiB: 24000 })
  const low = decide({ ...base, verdict: gpuJob({ needMiB: 256 }), lock: free, gpu: card(23500) })
  expect(low.kind).toBe('run')
})

test('a floor of 0 never refuses on memory', () => {
  const d = decide({ ...base, minFreeMiB: 0, verdict: gpuJob(), lock: free, gpu: card(24000) })
  expect(d.kind).toBe('run')
})

test('with no reading, or a failed one, the job runs and headroom is unknown', () => {
  const none = decide({ ...base, verdict: gpuJob(), lock: free, gpu: { kind: 'none' } })
  expect(none).toEqual({ kind: 'run', waits: false, freeMiB: null, totalMiB: null })
  const bad = decide({ ...base, verdict: gpuJob(), lock: free, gpu: { kind: 'error', message: 'x' } })
  expect(bad).toEqual({ kind: 'run', waits: false, freeMiB: null, totalMiB: null })
})

test('the devices a job names pick the card that is checked', () => {
  const gpu: Reading = {
    kind: 'ok',
    gpus: [
      { index: 0, name: 'a', usedMiB: 23800, totalMiB: 24000, util: 0, tempC: 1 },
      { index: 1, name: 'b', usedMiB: 1000, totalMiB: 24000, util: 0, tempC: 1 },
    ],
    apps: [],
  }
  const only0 = decide({ ...base, verdict: gpuJob({ devices: [0] }), lock: free, gpu })
  expect(only0.kind).toBe('refuse-memory')
  const any = decide({ ...base, verdict: gpuJob(), lock: free, gpu })
  expect(any.kind).toBe('run')
})
