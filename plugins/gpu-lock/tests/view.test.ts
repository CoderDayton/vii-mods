import { expect, test } from 'claude-code/testing'

import { bandModel, paneModel, statusLine } from '../src/view'
import type { Entry, Holder, Reading, Snapshot, Waiting } from '../types'

const now = 1_700_000_192_000

const holder = (extra: Partial<Holder> = {}): Holder => ({
  session: 's1',
  agent: null,
  cmd: 'python train.py',
  cwd: '/work',
  why: 'python + train.py',
  needMiB: null,
  pid: 4242,
  since: 1_700_000_000_000,
  ...extra,
})

const reading: Reading = {
  kind: 'ok',
  gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 4090', usedMiB: 5589, totalMiB: 24564, util: 3, tempC: 41 }],
  apps: [
    { pid: 2, name: 'python3', usedMiB: 900 },
    { pid: 1, name: 'ollama', usedMiB: 4100 },
  ],
}

const snap = (lock: Snapshot['lock'], gpu: Reading = reading, waiters: Holder[] = []): Snapshot => ({ at: now, lock, gpu, waiters })

const band = (over: Partial<Parameters<typeof bandModel>[0]> = {}) =>
  bandModel({
    snapshot: snap({ kind: 'held', holder: holder() }),
    waiting: null,
    enabled: true,
    mode: 'auto',
    now,
    session: 's1',
    width: 120,
    ...over,
  })

test('the band is hidden when off, never, or before the first reading', () => {
  expect(band({ enabled: false })).toBe(null)
  expect(band({ mode: 'never' })).toBe(null)
  expect(band({ snapshot: null })).toBe(null)
})

test('a free GPU shows only in always mode', () => {
  const free = snap({ kind: 'free' })
  expect(band({ snapshot: free })).toBe(null)
  const m = band({ snapshot: free, mode: 'always' })
  expect(m?.rows.length).toBe(1)
  expect(m?.rows[0]?.tone).toBe('free')
  expect(m?.rows[0]?.title).toBe('GPU free')
  expect(m?.meter?.text).toBe('5.5 / 24.0 GiB')
})

test('a lock held by this session is one row', () => {
  const m = band()
  expect(m).toEqual({
    rows: [{ tone: 'mine', title: 'GPU locked', who: 'this session', cmd: 'python train.py', elapsed: '3m 12s' }],
    meter: { bar: '██░░░░░░░░', text: '5.5 / 24.0 GiB' },
  })
})

test('a lock held by another session', () => {
  const m = band({ session: 'beef' })
  expect(m?.rows[0]?.tone).toBe('other')
  expect(m?.rows[0]?.who).toBe('session s1')
})

test('a lock held by an unknown process has no command or time', () => {
  const m = band({ snapshot: snap({ kind: 'held', holder: null }) })
  expect(m?.rows[0]?.who).toBe('an unknown process')
  expect(m?.rows[0]?.cmd).toBe('')
  expect(m?.rows[0]?.elapsed).toBe('')
})

test('a waiting job is a second row under the holder, with its own command and wait time', () => {
  const waiting: Waiting = { cmd: 'cargo bench', since: now - 12_000 }
  const m = band({ waiting, session: 'beef' })
  expect(m?.rows).toEqual([
    { tone: 'other', title: 'GPU locked', who: 'session s1', cmd: 'python train.py', elapsed: '3m 12s' },
    { tone: 'waiting', title: 'GPU waiting #1', who: 'this session', cmd: 'cargo bench', elapsed: '12s' },
  ])
})

test('a waiting job with nobody holding the lock is one row', () => {
  const waiting: Waiting = { cmd: 'cargo bench', since: now - 12_000 }
  const m = band({ waiting, snapshot: snap({ kind: 'free' }) })
  expect(m?.rows).toEqual([
    { tone: 'waiting', title: 'GPU waiting #1', who: 'this session', cmd: 'cargo bench', elapsed: '12s' },
  ])
})

const two = [holder(), holder({ session: 's2', pid: 7, cmd: 'python b.py', since: now - 30_000 })]

test('a shared GPU is one row per running job, with every session named', () => {
  const m = band({ snapshot: snap({ kind: 'shared', holders: two }), session: 's1' })
  expect(m?.rows).toEqual([
    { tone: 'mine', title: 'GPU shared', who: 'this session', cmd: 'python train.py', elapsed: '3m 12s' },
    { tone: 'other', title: 'GPU shared', who: 'session s2', cmd: 'python b.py', elapsed: '30s' },
  ])
  expect(m?.meter).not.toBe(null)
})

test('waiting sessions follow the running jobs, each on its own row', () => {
  const queued = [holder({ session: 's3', pid: 9, cmd: 'python c.py', since: now - 8_000 })]
  const m = band({ snapshot: snap({ kind: 'shared', holders: two }, reading, queued), session: 's1' })
  expect(m?.rows.map(r => r.title)).toEqual(['GPU shared', 'GPU shared', 'GPU waiting #1'])
  expect(m?.rows[2]).toEqual({ tone: 'waiting', title: 'GPU waiting #1', who: 'session s3', cmd: 'python c.py', elapsed: '8s' })
})

test('waiting rows are numbered in queue order, and this session joins at the back', () => {
  const queued = [
    holder({ session: 's3', pid: 9, cmd: 'first', since: now - 20_000 }),
    holder({ session: 's4', pid: 10, cmd: 'second', since: now - 10_000 }),
  ]
  const waiting: Waiting = { cmd: 'mine', since: now - 1_000 }
  const m = band({ snapshot: snap({ kind: 'free' }, reading, queued), waiting, session: 's1' })
  expect(m?.rows.map(r => `${r.title}|${r.cmd}`)).toEqual([
    'GPU waiting #1|first',
    'GPU waiting #2|second',
    'GPU waiting #3|mine',
  ])
})

test('a waiter on a free GPU still shows', () => {
  const queued = [holder({ session: 's3', cmd: 'python c.py', since: now - 8_000 })]
  const m = band({ snapshot: snap({ kind: 'free' }, reading, queued), session: 's1' })
  expect(m?.rows.length).toBe(1)
  expect(m?.rows[0]?.tone).toBe('waiting')
})

test('this session is not drawn twice once the reading lists its wait', () => {
  const waiting: Waiting = { cmd: 'python c.py', since: now - 8_000 }
  const queued = [holder({ session: 's1', cmd: 'python c.py', since: now - 8_000 })]
  const m = band({ snapshot: snap({ kind: 'shared', holders: [two[1] as Holder] }, reading, queued), waiting, session: 's1' })
  expect(m?.rows.filter(r => r.tone === 'waiting').length).toBe(1)
})

test('a snapshot kept from before waiters existed still draws', () => {
  const old = { at: now, lock: { kind: 'held', holder: holder() }, gpu: reading } as unknown as Snapshot
  expect(band({ snapshot: old })?.rows.length).toBe(1)
  const m = pane({ snapshot: old })
  expect(m.queue).toEqual([])
})

test('a long list is cut to five rows with a count of the rest', () => {
  const many = Array.from({ length: 8 }, (_, i) => holder({ session: `s${i}`, pid: 100 + i, cmd: `job ${i}` }))
  const m = band({ snapshot: snap({ kind: 'shared', holders: many }), session: 'zzzz' })
  expect(m?.rows.length).toBe(5)
  expect(m?.rows[4]?.cmd).toBe('+4 more')
})

test('the status line counts the other sessions', () => {
  expect(statusLine(band({ snapshot: snap({ kind: 'shared', holders: two }), session: 's1' }))).toBe(
    'GPU shared · this session · python train.py · 3m 12s · +1 more',
  )
})

test('the pane lists a shared GPU: headline, limit, running jobs and the queue', () => {
  const queued = [holder({ session: 's3', cmd: 'python c.py', since: now - 8_000, needMiB: 4096 })]
  const m = paneModel({
    snapshot: snap({ kind: 'shared', holders: two }, reading, queued),
    waiting: null,
    enabled: true,
    log: [],
    bad: [],
    now,
    session: 's1',
    maxPercent: 75,
  })
  expect(m.headline).toBe('Shared by 2 jobs')
  expect(m.detail).toBe('jobs may use 75% of memory together')
  expect(m.running.map(j => j.who)).toEqual(['this session', 'session s2'])
  expect(m.running[0]?.mine).toBe(true)
  expect(m.queue).toEqual([{ who: 'session s3', cmd: 'python c.py', elapsed: '8s', need: '4.0 GiB', mine: false, place: 1 }])
  expect(m.running.every(j => j.place === 0)).toBe(true)
  expect(m.queue.map(j => j.place)).toEqual([1])
})

test('an unavailable lock shows only in always mode', () => {
  const s = snap({ kind: 'unavailable', reason: 'flock is not installed' })
  expect(band({ snapshot: s })).toBe(null)
  const m = band({ snapshot: s, mode: 'always' })
  expect(m?.rows[0]?.tone).toBe('off')
  expect(m?.rows[0]?.cmd).toBe('flock is not installed')
})

test('no gpu reading means no meter', () => {
  expect(band({ snapshot: snap({ kind: 'held', holder: holder() }, { kind: 'none' }) })?.meter).toBe(null)
})

test('a narrow band clips the command first, then drops the meter, then the command', () => {
  const long = holder({ cmd: 'python scripts/a-very-long-training-script-name.py --epochs 100' })
  const cmdAt = (width: number) => band({ snapshot: snap({ kind: 'held', holder: long }), width })
  expect(cmdAt(140)?.rows[0]?.cmd.includes('…')).toBe(false)
  expect(cmdAt(100)?.rows[0]?.cmd.endsWith('…')).toBe(true)
  expect(cmdAt(100)?.meter).not.toBe(null)
  expect(cmdAt(50)?.meter).toBe(null)
  expect((cmdAt(50)?.rows[0]?.cmd.length ?? 0) >= 8).toBe(true)
  expect(cmdAt(20)?.rows[0]?.cmd).toBe('')
})

test('every row of a multi-session band gets the same command width', () => {
  const long = holder({ cmd: 'python scripts/a-very-long-training-script-name.py --epochs 100' })
  const waiting: Waiting = { cmd: 'cargo bench --all-features --release --no-fail-fast --workspace', since: now }
  const m = band({ snapshot: snap({ kind: 'held', holder: long }), waiting, session: 'beef', width: 100 })
  expect(m?.meter).not.toBe(null)
  expect(m?.rows.length).toBe(2)
  for (const r of m?.rows ?? []) {
    expect(r.cmd.endsWith('…')).toBe(true)
    expect(r.cmd.length).toBe(32)
  }
})

const pane = (over: Partial<Parameters<typeof paneModel>[0]> = {}) =>
  paneModel({
    snapshot: snap({ kind: 'held', holder: holder() }),
    waiting: null,
    enabled: true,
    log: [],
    bad: [],
    now,
    session: 's1',
    maxPercent: null,
    ...over,
  })

test('the pane names the lock, the card and the processes', () => {
  const m = pane()
  expect(m.headline).toBe('Locked by this session')
  expect(m.cmd).toBe('python train.py')
  expect(m.detail).toBe('/work · python + train.py · 3m 12s')
  expect(m.gpus).toEqual([
    { title: 'GPU 0  NVIDIA GeForce RTX 4090', bar: '██░░░░░░░░', used: '5.5 of 24.0 GiB', stats: '3% busy · 41°C' },
  ])
  expect(m.apps).toEqual([
    { name: 'ollama', mem: '4.0 GiB' },
    { name: 'python3', mem: '0.9 GiB' },
  ])
})

test('the pane headline for each lock state', () => {
  expect(pane({ snapshot: snap({ kind: 'free' }) }).headline).toBe('Free')
  expect(pane({ snapshot: null }).headline).toBe('Reading the GPU…')
  expect(pane({ enabled: false }).headline).toBe('Turned off')
  expect(pane({ snapshot: snap({ kind: 'held', holder: null }) }).headline).toBe('Locked by an unknown process')
  expect(pane({ session: 'beef' }).headline).toBe('Locked by session s1')
  expect(pane({ snapshot: snap({ kind: 'unavailable', reason: 'flock is not installed' }) }).headline).toBe(
    'Lock unavailable',
  )
  expect(pane({ waiting: { cmd: 'x', since: now } }).headline).toBe('Waiting for the lock')
})

test('the pane explains a missing or failed reading', () => {
  expect(pane({ snapshot: snap({ kind: 'free' }, { kind: 'none' }) }).note).toBe('No NVIDIA GPU or nvidia-smi found.')
  expect(pane({ snapshot: snap({ kind: 'free' }, { kind: 'error', message: 'driver gone' }) }).note).toBe(
    'nvidia-smi failed: driver gone',
  )
  expect(pane().note).toBe('')
})

test('the pane lists this session newest first, at most eight', () => {
  const log: Entry[] = Array.from({ length: 10 }, (_, i) => ({
    at: now - (10 - i) * 1000,
    kind: i === 9 ? 'refused' : i === 8 ? 'failed' : 'ran',
    cmd: `job ${i}`,
    ms: i === 9 ? null : 65_000,
    note: i === 9 ? 'locked by session 7f3a' : '',
  }))
  const m = pane({ log })
  expect(m.log.length).toBe(8)
  expect(m.log[0]).toEqual({ icon: '⊘', text: 'job 9 · locked by session 7f3a', when: '1s ago' })
  expect(m.log[1]?.icon).toBe('✗')
  expect(m.log[2]).toEqual({ icon: '✓', text: 'job 7 · 1m 05s', when: '3s ago' })
})

test('the status line is one plain line, or nothing', () => {
  expect(statusLine(band())).toBe('GPU locked · this session · python train.py · 3m 12s')
  expect(statusLine(band({ snapshot: snap({ kind: 'held', holder: null }) }))).toBe('GPU locked · an unknown process')
  expect(statusLine(null)).toBe(undefined)
})

test('bad patterns pass through', () => {
  expect(pane({ bad: ['(x'] }).bad).toEqual(['(x'])
})

test('the pane charts the memory history, and draws the cap only in shared mode', () => {
  const history = [{ at: now - 5_000, gpus: [{ usedMiB: 5589, totalMiB: 24564, jobs: {} }], jobs: {} }]
  const shared = pane({ history, columns: 20, maxPercent: 75 })
  expect(shared.chart?.cards[0]?.rows.length).toBe(4)
  expect(shared.chart?.cards[0]?.rows.some(r => r.label === ' 75%')).toBe(true)
  expect(pane({ history, columns: 20 }).chart?.cards[0]?.rows.some(r => r.label.includes('75'))).toBe(false)
  expect(pane().chart).toBe(null)
  expect(pane({ history: [], columns: 20 }).chart).toBe(null)
})

test('the pane titles each card chart with the card, and labels jobs for this session', () => {
  const history = [
    {
      at: now - 5_000,
      gpus: [
        { usedMiB: 5589, totalMiB: 24564, jobs: { '20': 4096 } },
        { usedMiB: 100, totalMiB: 8000, jobs: {} },
      ],
      jobs: { '20': { session: 's1', cmd: 'python a.py' } },
    },
  ]
  const two: Reading = {
    kind: 'ok',
    gpus: [
      { index: 0, name: 'Card A', usedMiB: 5589, totalMiB: 24564, util: null, tempC: null },
      { index: 1, name: 'Card B', usedMiB: 100, totalMiB: 8000, util: null, tempC: null },
    ],
    apps: [],
  }
  const m = pane({ snapshot: snap({ kind: 'free' }, two), history, columns: 20 })
  expect(m.chart?.cards.map(c => c.title)).toEqual(['GPU 0  Card A', 'GPU 1  Card B'])
  expect(m.chart?.legend[0]?.label).toBe('this session · python a.py')
})
