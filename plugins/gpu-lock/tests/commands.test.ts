import { expect, test } from 'claude-code/testing'

import { runCommand } from '../src/commands'
import type { Context } from '../src/commands'
import { readOptions } from '../src/options'
import type { Holder, Reading, Snapshot } from '../types'

const now = 1_700_000_192_000

const holder: Holder = {
  session: 's1',
  agent: null,
  cmd: 'python train.py',
  cwd: '/work',
  why: 'x',
  needMiB: null,
  pid: 4242,
  since: 1_700_000_000_000,
}

const reading: Reading = {
  kind: 'ok',
  gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 4090', usedMiB: 5589, totalMiB: 24564, util: 3, tempC: 41 }],
  apps: [{ pid: 1, name: 'ollama', usedMiB: 4100 }],
}

const ctx = (over: Partial<Context> = {}): Context => ({
  config: readOptions({}),
  snapshot: { at: now, lock: { kind: 'free' }, gpu: reading, waiters: [] } satisfies Snapshot,
  enabled: true,
  isPaneOpen: false,
  now,
  session: 's1',
  ...over,
})

test('no argument opens the pane', () => {
  expect(runCommand('', ctx())).toEqual({ text: 'GPU lock pane opened.', action: 'pane' })
  expect(runCommand('   ', ctx()).action).toBe('pane')
})

test('no argument closes the pane when it is already open', () => {
  expect(runCommand('', ctx({ isPaneOpen: true }))).toEqual({ text: 'GPU lock pane closed.', action: 'close' })
  expect(runCommand('   ', ctx({ isPaneOpen: true })).action).toBe('close')
})

test('close closes an open pane and says so when none is open', () => {
  expect(runCommand('close', ctx({ isPaneOpen: true }))).toEqual({ text: 'GPU lock pane closed.', action: 'close' })
  expect(runCommand('close', ctx())).toEqual({ text: 'The GPU lock pane is not open.' })
})

test('help lists how to close the pane, and pane is not an option', () => {
  expect(runCommand('help', ctx()).text.includes('/gpu close')).toBe(true)
  const pane = runCommand('pane', ctx())
  expect(pane.text.startsWith('Unknown option "pane".')).toBe(true)
  expect(pane.action).toBe(undefined)
})

test('on and off ask for the switch and say what it means', () => {
  const on = runCommand('on', ctx({ enabled: false }))
  expect(on.action).toBe('on')
  expect(on.text).toBe('gpu-lock is on.')
  const off = runCommand('off', ctx())
  expect(off.action).toBe('off')
  expect(off.text).toBe('gpu-lock is off. GPU commands run unchecked.')
})

test('status for a free GPU', () => {
  const t = runCommand('status', ctx()).text
  expect(t.split('\n')).toEqual([
    'gpu-lock is on.',
    'Lock: free.',
    'GPU: NVIDIA GeForce RTX 4090, 5.5 of 24.0 GiB used, 3% busy, 41°C.',
    'Other GPU users: ollama (4.0 GiB).',
    'Rules: one job at a time, wait 0s, least free 1.0 GiB, band auto, lock file /tmp/gpu-lock/lock.',
  ])
})

test('status for a shared GPU lists every job and every waiter', () => {
  const other = { ...holder, session: 's2', cmd: 'python b.py', pid: 5 }
  const snap = { at: now, lock: { kind: 'shared' as const, holders: [holder, other] }, gpu: reading, waiters: [{ ...holder, session: 's3', cmd: 'python c.py' }] }
  const t = runCommand('status', ctx({ snapshot: snap, config: readOptions({ mode: 'shared' }) })).text
  expect(t.includes('Lock: shared by this session: `python train.py` (3m 12s); session s2: `python b.py` (3m 12s).')).toBe(true)
  expect(t.includes('Waiting: session s3: `python c.py` (3m 12s).')).toBe(true)
  expect(t.includes('Rules: shared up to 75% of memory,')).toBe(true)
})

test('status reads a snapshot kept from before waiters existed', () => {
  const old = { at: now, lock: { kind: 'free' }, gpu: reading } as unknown as Snapshot
  expect(runCommand('status', ctx({ snapshot: old })).text.includes('Lock: free.')).toBe(true)
})

test('status for a lock held by this session or by another', () => {
  const held = { at: now, lock: { kind: 'held' as const, holder }, gpu: reading, waiters: [] }
  expect(runCommand('status', ctx({ snapshot: held })).text.includes('Lock: held by this session: `python train.py` (3m 12s).')).toBe(true)
  expect(runCommand('status', ctx({ snapshot: held, session: 'beef' })).text.includes('Lock: held by session s1:')).toBe(true)
})

test('status when the lock, the reading or the first read is missing', () => {
  const lock = { at: now, lock: { kind: 'unavailable' as const, reason: 'flock is not installed' }, gpu: { kind: 'none' as const }, waiters: [] }
  const t = runCommand('status', ctx({ snapshot: lock })).text
  expect(t.includes('Lock: unavailable (flock is not installed).')).toBe(true)
  expect(t.includes('GPU: no NVIDIA GPU or nvidia-smi found.')).toBe(true)
  const err = { at: now, lock: { kind: 'free' as const }, gpu: { kind: 'error' as const, message: 'driver gone' }, waiters: [] }
  expect(runCommand('status', ctx({ snapshot: err })).text.includes('GPU: nvidia-smi failed: driver gone.')).toBe(true)
  expect(runCommand('status', ctx({ snapshot: null })).text.includes('Lock: not read yet.')).toBe(true)
})

test('status says when it is off and lists patterns that did not compile', () => {
  const t = runCommand('status', ctx({ enabled: false, config: readOptions({ extraPatterns: '(bad' }) })).text
  expect(t.startsWith('gpu-lock is off.')).toBe(true)
  expect(t.includes('Ignored patterns (not valid): (bad')).toBe(true)
})

test('check says whether a command counts, and what it needs', () => {
  const yes = runCommand('check python train.py # gpu 8g', ctx()).text
  expect(yes).toBe('That counts as a GPU job (python + train.py). It needs 8.0 GiB free.')
  const plain = runCommand('check python train.py', ctx()).text
  expect(plain).toBe('That counts as a GPU job (python + train.py). It needs 1.0 GiB free (the least-free rule).')
  const dev = runCommand('check CUDA_VISIBLE_DEVICES=1,2 python run.py', ctx()).text
  expect(dev.includes('Devices: 1, 2.')).toBe(true)
  const no = runCommand('check ls -la', ctx()).text
  expect(no).toBe('That does not count as a GPU job. End a command with `# gpu` to force the lock.')
})

test('check with no command, and help for anything unknown', () => {
  expect(runCommand('check', ctx()).text).toBe('Usage: /gpu check <command>')
  const help = runCommand('frobnicate', ctx()).text
  expect(help.startsWith('Unknown option "frobnicate".')).toBe(true)
  expect(help.includes('/gpu status')).toBe(true)
  expect(help.includes('# nogpu')).toBe(true)
  expect(runCommand('help', ctx()).text.startsWith('/gpu ')).toBe(true)
})
