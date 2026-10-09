import { expect, test } from 'claude-code/testing'

import type { Holder, Snapshot } from '../types'
import { chartsOf, MAX_SAMPLES, parseSamples, sampleLine, sampleOf, SPAN_MS } from '../src/history'
import type { Charts, Sample } from '../src/history'

const now = 1_700_000_000_000
const total = 24_576

const holder = (pid: number, session: string, cmd: string): Holder => ({
  session,
  agent: null,
  cmd,
  cwd: '/work',
  why: '',
  pid,
  since: now - 60_000,
  needMiB: null,
})

const parentsOf = (pairs: [number, number][]) => new Map(pairs)

const gpu = (index: number, usedMiB: number, uuid?: string) => ({
  index,
  name: `Card ${index}`,
  usedMiB,
  totalMiB: 8000,
  util: null,
  tempC: null,
  ...(uuid === undefined ? {} : { uuid }),
})

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  at: now,
  lock: { kind: 'free' },
  waiters: [],
  gpu: { kind: 'ok', gpus: [gpu(0, 100)], apps: [] },
  ...over,
})

test('a sample keeps each card apart and gives each job its share of the card it runs on', () => {
  const snap = snapshot({
    lock: { kind: 'shared', holders: [holder(20, 's1', 'python a.py'), holder(30, 's2', 'python b.py')] },
    gpu: {
      kind: 'ok',
      gpus: [gpu(0, 6000, 'GPU-a'), gpu(1, 3000, 'GPU-b')],
      apps: [
        { pid: 200, name: 'python3', usedMiB: 4096, gpu: 'GPU-a' },
        { pid: 300, name: 'python3', usedMiB: 2048, gpu: 'GPU-b' },
        { pid: 999, name: 'chrome', usedMiB: 1024, gpu: 'GPU-a' },
      ],
    },
  })
  const parents = parentsOf([
    [200, 20],
    [300, 30],
    [999, 1],
  ])
  expect(sampleOf(snap, parents)).toEqual({
    at: now,
    gpus: [
      { usedMiB: 6000, totalMiB: 8000, jobs: { '20': 4096 } },
      { usedMiB: 3000, totalMiB: 8000, jobs: { '30': 2048 } },
    ],
    jobs: { '20': { session: 's1', cmd: 'python a.py' }, '30': { session: 's2', cmd: 'python b.py' } },
  })
})

test('the exclusive holder gets its processes too', () => {
  const snap = snapshot({
    lock: { kind: 'held', holder: holder(20, 's1', 'python a.py') },
    gpu: { kind: 'ok', gpus: [gpu(0, 5000)], apps: [{ pid: 200, name: 'python3', usedMiB: 4000 }] },
  })
  const s = sampleOf(snap, parentsOf([[200, 20]]))
  expect(s?.gpus[0]?.jobs).toEqual({ '20': 4000 })
})

test('an app with no card named runs on the only card, and is not placed when there are several', () => {
  const lock = { kind: 'shared' as const, holders: [holder(20, 's1', 'x')] }
  const parents = parentsOf([[200, 20]])
  const apps = [{ pid: 200, name: 'p', usedMiB: 900 }]
  const one = sampleOf(snapshot({ lock, gpu: { kind: 'ok', gpus: [gpu(0, 1000)], apps } }), parents)
  expect(one?.gpus[0]?.jobs).toEqual({ '20': 900 })
  const two = sampleOf(snapshot({ lock, gpu: { kind: 'ok', gpus: [gpu(0, 1000), gpu(1, 1000)], apps } }), parents)
  expect(two?.gpus.map(g => g.jobs)).toEqual([{}, {}])
})

test('without a process tree nothing is attributed, and a job never exceeds its card', () => {
  const lock = { kind: 'shared' as const, holders: [holder(20, 's1', 'x')] }
  const gpuReading = {
    kind: 'ok' as const,
    gpus: [gpu(0, 500)],
    apps: [{ pid: 200, name: 'p', usedMiB: 900 }],
  }
  expect(sampleOf(snapshot({ lock, gpu: gpuReading }), null)?.gpus[0]?.jobs).toEqual({})
  expect(sampleOf(snapshot({ lock, gpu: gpuReading }), parentsOf([[200, 20]]))?.gpus[0]?.jobs).toEqual({ '20': 500 })
})

test('no reading, no sample', () => {
  expect(sampleOf(snapshot({ gpu: { kind: 'none' } }), null)).toBe(null)
  expect(sampleOf(snapshot({ gpu: { kind: 'error', message: 'x' } }), null)).toBe(null)
  expect(sampleOf(snapshot({ gpu: { kind: 'ok', gpus: [], apps: [] } }), null)).toBe(null)
})

const sample = (agoMs: number, usedMiB: number, jobs: Record<string, number> = {}, meta: Sample['jobs'] = {}): Sample => ({
  at: now - agoMs,
  gpus: [{ usedMiB, totalMiB: total, jobs }],
  jobs: meta,
})

test('a sample goes to one line of the file and reads back the same', () => {
  const s = sample(1_000, 4096, { '20': 2048 }, { '20': { session: 's1', cmd: 'python a.py' } })
  const line = sampleLine(s)
  expect(line.includes('\n')).toBe(false)
  expect(parseSamples(`${line}\n`, now)).toEqual([s])
})

test('the file is read in time order, and lines that are not samples are skipped', () => {
  const a = sample(30_000, 1)
  const b = sample(10_000, 2)
  const text = [
    sampleLine(b),
    'not json',
    '{"at":1700000000000,"usedMiB":5,"totalMiB":9}',
    '{"at":"x","gpus":[{"usedMiB":1,"totalMiB":2,"jobs":{}}],"jobs":{}}',
    '{"at":1700000000000,"gpus":[{"usedMiB":-1,"totalMiB":2,"jobs":{}}],"jobs":{}}',
    '{"at":1700000000000,"gpus":[],"jobs":{}}',
    JSON.stringify(sample(SPAN_MS + 5_000, 3)),
    JSON.stringify(sample(-3_600_000, 4)),
    sampleLine(a),
  ].join('\n')
  expect(parseSamples(text, now).map(s => s.gpus[0]?.usedMiB)).toEqual([1, 2])
})

test('a hostile line is cleaned and clipped', () => {
  const evil = {
    at: now - 1_000,
    gpus: [{ usedMiB: 1, totalMiB: 2, jobs: { '20': 1, 'x y': 5, '21': 'big' } }],
    jobs: { '20': { session: 's\u001b[31m1', cmd: 'a'.repeat(500) }, '../etc': { session: 'q', cmd: 'q' } },
  }
  const [s] = parseSamples(JSON.stringify(evil), now)
  expect(s?.gpus[0]?.jobs).toEqual({ '20': 1 })
  expect(Object.keys(s?.jobs ?? {})).toEqual(['20'])
  expect(s?.jobs['20']?.session.includes('\u001b')).toBe(false)
  expect((s?.jobs['20']?.cmd.length ?? 0) <= 60).toBe(true)
})

test('only the newest samples are kept', () => {
  const lines = Array.from({ length: MAX_SAMPLES + 20 }, (_, i) => sampleLine(sample(10_000 - i, i)))
  const out = parseSamples(lines.join('\n'), now)
  expect(out.length).toBe(MAX_SAMPLES)
  expect(out[out.length - 1]?.gpus[0]?.usedMiB).toBe(MAX_SAMPLES + 19)
})

const charts = (history: Sample[], over: Partial<Parameters<typeof chartsOf>[0]> = {}): Charts | null =>
  chartsOf({ history, now, columns: 10, rows: 2, capPercent: null, session: 's1', titles: ['Card 0'], ...over })

const text = (c: Charts, row: number, card = 0) => (c.cards[card]?.rows[row]?.runs ?? []).map(r => r.text).join('')

test('no history, or a chart too narrow to read, draws nothing', () => {
  expect(charts([])).toBe(null)
  expect(charts(undefined as never)).toBe(null)
  expect(charts([sample(0, 1000)], { columns: 3 })).toBe(null)
  expect(charts([{ at: now, gpus: [], jobs: {} }])).toBe(null)
})

test('the newest sample fills the last column, half full is half the height', () => {
  const c = charts([sample(5_000, total / 2)])!
  expect(c.cards[0]?.rows.length).toBe(2)
  expect(text(c, 1)).toBe('         █')
  expect(text(c, 0)).toBe('          ')
})

test('a column rises in eighths of a row', () => {
  const c = charts([sample(5_000, total / 4)])!
  expect(text(c, 1).endsWith('▄')).toBe(true)
  expect(text(c, 0).trim()).toBe('')
  const full = charts([sample(5_000, total)])!
  expect(text(full, 0).endsWith('█')).toBe(true)
  expect(text(full, 1).endsWith('█')).toBe(true)
})

test('any use at all shows at least the smallest block', () => {
  expect(text(charts([sample(5_000, 1)])!, 1).endsWith('▁')).toBe(true)
  expect(text(charts([sample(5_000, 0)])!, 1).trim()).toBe('')
})

test('a column shows the fullest sample in its slice of time', () => {
  const c = charts([sample(5_000, total / 4), sample(20_000, total), sample(40_000, total / 2)])!
  expect(text(c, 0).endsWith('█')).toBe(true)
})

test('a quiet stretch leaves blank columns', () => {
  const c = charts([sample(5_000, total), sample(SPAN_MS - 10_000, total)])!
  expect(text(c, 1)).toBe('█        █')
})

test('the cap draws as a dashed line on its row, with its own label', () => {
  const c = charts([sample(5_000, total * 0.1)], { rows: 4, capPercent: 75 })!
  expect(c.cards[0]?.rows.map(r => r.label)).toEqual(['100%', ' 75%', '    ', '  0%'])
  expect(text(c, 1)).toBe('╌'.repeat(10))
  expect(c.cards[0]?.rows[1]?.runs).toEqual([{ text: '╌'.repeat(10), fg: 'cap', bg: null }])
  expect(text(c, 0).trim()).toBe('')
})

test('without a cap the labels are the top and the bottom only', () => {
  const c = charts([sample(5_000, 1000)], { rows: 3 })!
  expect(c.cards[0]?.rows.map(r => r.label)).toEqual(['100%', '    ', '  0%'])
})

test('the axis names the span once, and each card sums up its own memory', () => {
  const c = charts([sample(30_000, 18 * 1024), sample(5_000, 5.5 * 1024)], { columns: 20 })!
  expect(c.axis.trim().startsWith('10m ago')).toBe(true)
  expect(c.axis.trimEnd().endsWith('now')).toBe(true)
  expect(c.cards[0]?.summary).toBe('now 5.5 of 24.0 GiB · peak 18.0 GiB')
})

const twoCards = (usedA: number, usedB: number): Sample => ({
  at: now - 5_000,
  gpus: [
    { usedMiB: usedA, totalMiB: 8000, jobs: {} },
    { usedMiB: usedB, totalMiB: 16000, jobs: {} },
  ],
  jobs: {},
})

test('every card gets its own chart and title; one card is titled for the memory', () => {
  const c = charts([twoCards(8000, 4000)], { titles: ['GPU 0  Card A', 'GPU 1  Card B'] })!
  expect(c.cards.map(k => k.title)).toEqual(['GPU 0  Card A', 'GPU 1  Card B'])
  expect(text(c, 1, 0).endsWith('█')).toBe(true)
  expect(text(c, 0, 0).endsWith('█')).toBe(true)
  expect(text(c, 0, 1).trim()).toBe('')
  expect(c.cards[1]?.summary.startsWith('now 3.9 of 15.6 GiB')).toBe(true)
  expect(charts([sample(5_000, 100)])!.cards[0]?.title).toBe('GPU memory')
})

test('a card missing from some samples is blank there', () => {
  const c = charts([sample(30_000, total), twoCards(8000, 8000)], { titles: ['A', 'B'] })!
  expect(c.cards.length).toBe(2)
})

const JOBS = { '20': { session: 's1', cmd: 'python a.py' }, '30': { session: 's2', cmd: 'python b.py' } }

test('a column is stacked by job, in the order the jobs first appear, and the rest sits on top', () => {
  const quarter = 4096
  const s = sample(5_000, quarter * 3, { '20': quarter, '30': quarter }, JOBS)
  s.gpus[0]!.totalMiB = quarter * 4
  const c = charts([s])!
  const bottom = c.cards[0]?.rows[1]?.runs ?? []
  const top = c.cards[0]?.rows[0]?.runs ?? []
  expect(bottom[bottom.length - 1]).toEqual({ text: '▄', fg: 0, bg: 1 })
  expect(top[top.length - 1]).toEqual({ text: '▄', fg: 'other', bg: null })
})

test('a job keeps its colour for as long as it is in the chart', () => {
  const first = sample(120_000, 4096, { '20': 4096 }, { '20': JOBS['20'] })
  const second = sample(5_000, 8192, { '30': 4096, '20': 4096 }, JOBS)
  second.gpus[0]!.totalMiB = 8192
  const c = charts([first, second], { columns: 20 })!
  const paints = new Set(c.cards[0]?.rows.flatMap(row => row.runs.flatMap(r => [r.fg, r.bg])))
  expect(paints.has(0)).toBe(true)
  expect(paints.has(1)).toBe(true)
  expect(c.legend.map(l => l.paint)).toEqual([0, 1])
})

test('the legend names each job in the newest sample, and the memory no job owns', () => {
  const s = sample(5_000, 10_240, { '20': 4096, '30': 2048 }, JOBS)
  const c = charts([s])!
  expect(c.legend).toEqual([
    { paint: 0, label: 'this session · python a.py', mem: '4.0 GiB' },
    { paint: 1, label: 'session s2 · python b.py', mem: '2.0 GiB' },
    { paint: 'other', label: 'other processes', mem: '4.0 GiB' },
  ])
})

test('with no job in the chart there is no legend', () => {
  expect(charts([sample(5_000, 4096)])!.legend).toEqual([])
})
