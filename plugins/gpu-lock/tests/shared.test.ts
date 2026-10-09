import { expect, test } from 'claude-code/testing'

import { classify } from '../src/classify'
import { gateOf, jobsDirOf, parseListing, waitingDirOf } from '../src/lock'
import { readOptions } from '../src/options'
import { decide } from '../src/policy'
import { RAMP_SECONDS, shareRoom } from '../src/share'
import { readLock } from '../src/sys'
import type { Sys } from '../src/sys'
import type { Gpu, Holder, Reading } from '../types'

const now = 1_700_000_100_000

const holder = (extra: Partial<Holder> = {}): Holder => ({
  session: 's1',
  agent: null,
  cmd: 'python train.py',
  cwd: '/w',
  why: 'python + train.py',
  needMiB: 6000,
  pid: 4242,
  since: now - 120_000,
  ...extra,
})

const gpu = (usedMiB: number, extra: Partial<Gpu> = {}): Gpu => ({
  index: 0,
  name: 'RTX 4090',
  usedMiB,
  totalMiB: 24000,
  util: 0,
  tempC: 40,
  ...extra,
})

const reading = (usedMiB: number): Reading => ({ kind: 'ok', gpus: [gpu(usedMiB)], apps: [] })

test('shared mode is off by default, with a 75% cap', () => {
  const c = readOptions({})
  expect(c.mode).toBe('exclusive')
  expect(c.maxVramPercent).toBe(75)
})

test('mode and the cap are read, and clamped', () => {
  expect(readOptions({ mode: 'shared' }).mode).toBe('shared')
  expect(readOptions({ mode: 'bogus' }).mode).toBe('exclusive')
  expect(readOptions({ maxVramPercent: 60 }).maxVramPercent).toBe(60)
  expect(readOptions({ maxVramPercent: 500 }).maxVramPercent).toBe(100)
  expect(readOptions({ maxVramPercent: 1 }).maxVramPercent).toBe(10)
  expect(readOptions({ maxVramPercent: 'x' }).maxVramPercent).toBe(75)
})

test('slot, queue and gate paths sit beside the lock file', () => {
  expect(jobsDirOf('/tmp/gpu-lock/lock')).toBe('/tmp/gpu-lock/jobs')
  expect(waitingDirOf('/tmp/gpu-lock/lock')).toBe('/tmp/gpu-lock/waiting')
  expect(gateOf('/tmp/gpu-lock/lock')).toBe('/tmp/gpu-lock/gate')
})

const json = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session: 's1', agent: null, cmd: 'python a.py', cwd: '/w', why: 'x', needMiB: 4000, pid: 11, since: 1_700_000_000, ...extra })

test('the listing splits running jobs from waiting ones, oldest first, and drops junk', () => {
  const out = [
    `jobs ${json({ pid: 12, since: 1_700_000_050, cmd: 'second' })}`,
    `jobs ${json({ pid: 11, since: 1_700_000_000, cmd: 'first' })}`,
    `waiting ${json({ pid: 13, cmd: 'queued' })}`,
    'jobs not json',
    'other {}',
    '',
  ].join('\n')
  const l = parseListing(out)
  expect(l.jobs.map(j => j.cmd)).toEqual(['first', 'second'])
  expect(l.waiters.map(j => j.cmd)).toEqual(['queued'])
  expect(l.jobs[0]?.since).toBe(1_700_000_000_000)
})

const fakeSys = (probeExit: number, stdout = ''): Sys => ({
  process: { run: async () => ({ exitCode: probeExit, stdout, stderr: '' }) },
  fs: { read: async () => { throw new Error('ENOENT') }, exists: async () => true },
})

test('probe exit 4 is a shared lock that lists every running job', async () => {
  const out = `jobs ${json({ cmd: 'a' })}\njobs ${json({ pid: 12, cmd: 'b' })}\nwaiting ${json({ pid: 13, cmd: 'c' })}`
  const r = await readLock(fakeSys(4, out), '/tmp/gpu-lock/lock')
  expect(r.lock.kind).toBe('shared')
  expect(r.lock.kind === 'shared' && r.lock.holders.map(h => h.cmd)).toEqual(['a', 'b'])
  expect(r.waiters.map(w => w.cmd)).toEqual(['c'])
})

test('a free lock can still have sessions waiting', async () => {
  const r = await readLock(fakeSys(1, `waiting ${json({ cmd: 'c' })}`), '/tmp/gpu-lock/lock')
  expect(r.lock).toEqual({ kind: 'free' })
  expect(r.waiters.length).toBe(1)
})

test('a shared lock nobody has named is shared with no holders', async () => {
  const r = await readLock(fakeSys(4), '/tmp/gpu-lock/lock')
  expect(r.lock).toEqual({ kind: 'shared', holders: [] })
})

test('room is the cap minus what is used and what young jobs have reserved', () => {
  const young = holder({ since: now - 5_000, needMiB: 3000 })
  const old = holder({ since: now - 120_000, needMiB: 9000 })
  const r = shareRoom({ gpus: [gpu(6000)], devices: null, need: 4000, holders: [young, old], now, maxPercent: 75 })
  expect(r).toEqual({ ok: true, capMiB: 18000, usedMiB: 9000, totalMiB: 24000, freeMiB: 18000, shared: true })
})

test('a job that would pass the cap does not fit beside others', () => {
  const r = shareRoom({ gpus: [gpu(15000)], devices: null, need: 4000, holders: [holder()], now, maxPercent: 75 })
  expect(r?.ok).toBe(false)
  expect(r?.usedMiB).toBe(15000)
  expect(r?.capMiB).toBe(18000)
})

test('the first job only has to fit in free memory, even past the cap', () => {
  const r = shareRoom({ gpus: [gpu(2000)], devices: null, need: 20000, holders: [], now, maxPercent: 75 })
  expect(r?.ok).toBe(true)
  expect(r?.shared).toBe(false)
  const tooBig = shareRoom({ gpus: [gpu(6000)], devices: null, need: 20000, holders: [], now, maxPercent: 75 })
  expect(tooBig?.ok).toBe(false)
})

test('the best card of the named devices is used', () => {
  const gpus = [gpu(20000, { index: 0 }), gpu(1000, { index: 1 })]
  expect(shareRoom({ gpus, devices: [0], need: 2000, holders: [holder()], now, maxPercent: 75 })?.ok).toBe(false)
  expect(shareRoom({ gpus, devices: null, need: 2000, holders: [holder()], now, maxPercent: 75 })?.ok).toBe(true)
})

test('young is a number of seconds the wrapper shares', () => {
  expect(RAMP_SECONDS).toBeGreaterThan(0)
})

const verdict = (needMiB: number | null = 4000) => classify(`python t.py # gpu${needMiB === null ? '' : ` ${needMiB}m`}`, { extra: [], skip: [], lockPath: '/x' })

const base = {
  minFreeMiB: 1024,
  waitSeconds: 0,
  mode: 'shared' as const,
  maxPercent: 75,
  now,
  waiters: [] as Holder[],
}

const queued = [holder({ session: 's9', pid: 99, cmd: 'python waits.py', since: now - 10_000 })]

test('a job that arrives while others wait does not skip the line, in either mode', () => {
  for (const mode of ['shared', 'exclusive'] as const) {
    const d = decide({ ...base, mode, waiters: queued, verdict: verdict(), lock: { kind: 'free' }, gpu: reading(1000) })
    expect(d).toEqual({ kind: 'refuse-queue', waiters: queued })
  }
})

test('with a wait set, a job that meets a queue joins it', () => {
  for (const mode of ['shared', 'exclusive'] as const) {
    const d = decide({ ...base, mode, waitSeconds: 30, waiters: queued, verdict: verdict(), lock: { kind: 'free' }, gpu: reading(1000) })
    expect(d).toEqual({ kind: 'run', waits: true, freeMiB: null, totalMiB: null })
  }
})

test('a held lock still reports busy before the queue', () => {
  const d = decide({ ...base, waiters: queued, verdict: verdict(), lock: { kind: 'held', holder: holder() }, gpu: reading(1000) })
  expect(d.kind).toBe('refuse-busy')
})

test('a shared lock with a queue still reports the queue, not the limit', () => {
  const d = decide({ ...base, waiters: queued, verdict: verdict(), lock: { kind: 'shared', holders: [holder()] }, gpu: reading(1000) })
  expect(d.kind).toBe('refuse-queue')
})

test('shared mode runs a job beside another when the cap holds', () => {
  const d = decide({ ...base, verdict: verdict(), lock: { kind: 'shared', holders: [holder()] }, gpu: reading(8000) })
  expect(d).toEqual({ kind: 'run', waits: false, freeMiB: 16000, totalMiB: 24000 })
})

test('shared mode refuses a job that would pass the cap, and names the holders', () => {
  const holders = [holder()]
  const d = decide({ ...base, verdict: verdict(), lock: { kind: 'shared', holders }, gpu: reading(16000) })
  expect(d).toEqual({
    kind: 'refuse-share',
    needMiB: 4000,
    usedMiB: 16000,
    capMiB: 18000,
    totalMiB: 24000,
    percent: 75,
    holders,
  })
})

test('shared mode queues a job over the cap when a wait is set', () => {
  const d = decide({ ...base, waitSeconds: 30, verdict: verdict(), lock: { kind: 'shared', holders: [holder()] }, gpu: reading(16000) })
  expect(d.kind).toBe('run')
  expect(d.kind === 'run' && d.waits).toBe(true)
})

test('shared mode treats an exclusive holder as a closed door', () => {
  const d = decide({ ...base, verdict: verdict(), lock: { kind: 'held', holder: holder() }, gpu: reading(1000) })
  expect(d).toEqual({ kind: 'refuse-busy', holders: [holder()] })
})

test('exclusive mode treats a shared lock as busy, with every holder named', () => {
  const holders = [holder(), holder({ pid: 5, session: 's2' })]
  const d = decide({ ...base, mode: 'exclusive', verdict: verdict(), lock: { kind: 'shared', holders }, gpu: reading(1000) })
  expect(d).toEqual({ kind: 'refuse-busy', holders })
})

test('an unknown exclusive holder is an empty list', () => {
  const d = decide({ ...base, mode: 'exclusive', verdict: verdict(), lock: { kind: 'held', holder: null }, gpu: reading(1000) })
  expect(d).toEqual({ kind: 'refuse-busy', holders: [] })
})

test('shared mode with no reading lets the job run and leaves the check to the wrapper', () => {
  const d = decide({ ...base, verdict: verdict(), lock: { kind: 'free' }, gpu: { kind: 'none' } })
  expect(d).toEqual({ kind: 'run', waits: false, freeMiB: null, totalMiB: null })
})
