import type { Entry, Holder, Reading, Sample, Snapshot, Waiting } from '../types'
import type { Band } from './options'
import { bar, clean, duration, gib, ratio } from './format'
import { chartsOf } from './history'
import type { Charts } from './history'
import { waitersOf } from './lock'
import { isMine, whoLabel } from './messages'

export type Tone = 'mine' | 'other' | 'waiting' | 'free' | 'off'

export type BandRow = { tone: Tone; title: string; who: string; cmd: string; elapsed: string }

export type BandModel = {
  rows: BandRow[]
  meter: { bar: string; text: string } | null
}

export type BandInput = {
  snapshot: Snapshot | null
  waiting: Waiting | null
  enabled: boolean
  mode: Band
  now: number
  session: string
  width: number
}

const METER_WIDTH = 10
const MIN_CMD = 8

const meterOf = (gpu: Reading): { bar: string; text: string } | null => {
  if (gpu.kind !== 'ok' || gpu.gpus.length === 0) return null
  const used = gpu.gpus.reduce((sum, g) => sum + g.usedMiB, 0)
  const total = gpu.gpus.reduce((sum, g) => sum + g.totalMiB, 0)
  return { bar: bar(used, total, METER_WIDTH), text: `${(used / 1024).toFixed(1)} / ${gib(total)}` }
}

const whoOf = (lock: Snapshot['lock'], session: string): { who: string; mine: boolean } => {
  const holder = lock.kind === 'held' ? lock.holder : null
  return { who: whoLabel(holder, session), mine: isMine(holder, session) }
}

const COLUMN_GAP = 2
const MAX_ROWS = 5

export const columnWidths = (rows: readonly BandRow[]) => ({
  title: Math.max(...rows.map(r => r.title.length)),
  who: Math.max(...rows.map(r => r.who.length)),
  elapsed: Math.max(...rows.map(r => r.elapsed.length)),
})

// Columns across a row: dot, title, who, cmd, elapsed, meter. The dot is 1 cell; empty columns drop out.
const fit = (rows: BandRow[], meter: BandModel['meter'], width: number): BandModel => {
  const w = columnWidths(rows)
  const room = (withMeter: boolean): number => {
    const meterWidth = withMeter && meter !== null ? METER_WIDTH + 1 + meter.text.length : 0
    const fixed = [1, w.title, w.who, w.elapsed, meterWidth].filter(c => c > 0)
    return width - fixed.reduce((a, b) => a + b, 0) - COLUMN_GAP * fixed.length
  }
  let kept = meter
  let budget = room(true)
  if (budget < MIN_CMD && kept !== null) {
    kept = null
    budget = room(false)
  }
  return { rows: rows.map(r => ({ ...r, cmd: budget < MIN_CMD ? '' : clean(r.cmd, budget) })), meter: kept }
}

const holderRow = (h: Holder | null, title: string, i: BandInput): BandRow => ({
  tone: isMine(h, i.session) ? 'mine' : 'other',
  title,
  who: whoLabel(h, i.session),
  cmd: h?.cmd ?? '',
  elapsed: h === null ? '' : duration(i.now - h.since),
})

const waiterRow = (h: Holder, place: number, i: BandInput): BandRow => ({
  tone: 'waiting',
  title: `GPU waiting #${place}`,
  who: whoLabel(h, i.session),
  cmd: h.cmd,
  elapsed: duration(i.now - h.since),
})

// One row per running job, then one per waiting job from every session.
// This session's own wait shows at once, before the next reading lists it.
const sessionRows = (i: BandInput, snap: Snapshot): BandRow[] => {
  const { lock } = snap
  const rows: BandRow[] = []
  if (lock.kind === 'held') rows.push(holderRow(lock.holder, 'GPU locked', i))
  if (lock.kind === 'shared') {
    if (lock.holders.length === 0) rows.push(holderRow(null, 'GPU shared', i))
    for (const h of lock.holders) rows.push(holderRow(h, 'GPU shared', i))
  }
  const waiters = waitersOf(snap)
  waiters.forEach((h, n) => rows.push(waiterRow(h, n + 1, i)))
  if (i.waiting !== null && !waiters.some(h => isMine(h, i.session))) {
    rows.push({
      tone: 'waiting',
      title: `GPU waiting #${waiters.length + 1}`,
      who: 'this session',
      cmd: i.waiting.cmd,
      elapsed: duration(i.now - i.waiting.since),
    })
  }
  return rows
}

const limitRows = (rows: BandRow[]): BandRow[] =>
  rows.length <= MAX_ROWS
    ? rows
    : [...rows.slice(0, MAX_ROWS - 1), { tone: 'off', title: '', who: '', cmd: `+${rows.length - MAX_ROWS + 1} more`, elapsed: '' }]

export const bandModel = (i: BandInput): BandModel | null => {
  if (!i.enabled || i.mode === 'never' || i.snapshot === null) return null
  const { lock, gpu } = i.snapshot
  const meter = meterOf(gpu)

  const rows = limitRows(sessionRows(i, i.snapshot))
  if (rows.length > 0) return fit(rows, meter, i.width)
  if (i.mode !== 'always') return null
  if (lock.kind === 'unavailable') {
    return fit([{ tone: 'off', title: 'GPU lock off', who: '', cmd: lock.reason, elapsed: '' }], null, i.width)
  }
  return fit([{ tone: 'free', title: 'GPU free', who: '', cmd: '', elapsed: '' }], meter, i.width)
}

export const statusLine = (model: BandModel | null): string | undefined => {
  const row = model?.rows[0]
  if (model === null || row === undefined) return undefined
  const more = model.rows.length > 1 ? `+${model.rows.length - 1} more` : ''
  return [row.title, row.who, row.cmd, row.elapsed, more].filter(p => p !== '').join(' · ')
}

// place is 0 for a running job, and the 1-based position in line for a waiting one.
export type PaneJob = { who: string; cmd: string; elapsed: string; need: string; mine: boolean; place: number }

export type PaneModel = {
  headline: string
  tone: Tone | 'unknown'
  cmd: string
  detail: string
  gpus: { title: string; bar: string; used: string; stats: string }[]
  apps: { name: string; mem: string }[]
  running: PaneJob[]
  queue: PaneJob[]
  note: string
  chart: Charts | null
  log: { icon: string; text: string; when: string }[]
  bad: string[]
  enabled: boolean
}

export type PaneInput = {
  snapshot: Snapshot | null
  waiting: Waiting | null
  enabled: boolean
  log: readonly Entry[]
  bad: readonly string[]
  now: number
  session: string
  maxPercent: number | null
  history?: readonly Sample[]
  columns?: number
}

// A lone card gets a taller chart; with several, each takes fewer rows so they all fit.
const CHART_ROWS = 4
const CARD_CHART_ROWS = 3

const paneJob = (h: Holder, i: PaneInput, place = 0): PaneJob => ({
  place,
  who: whoLabel(h, i.session),
  cmd: h.cmd,
  elapsed: duration(i.now - h.since),
  need: h.needMiB === null ? '' : gib(h.needMiB),
  mine: isMine(h, i.session),
})

const LOG_ROWS = 8
const ICONS = { ran: '✓', failed: '✗', refused: '⊘' } as const

const lockPart = (i: PaneInput): Pick<PaneModel, 'headline' | 'tone' | 'cmd' | 'detail'> => {
  const none = { cmd: '', detail: '' }
  if (!i.enabled) return { headline: 'Turned off', tone: 'off', ...none }
  if (i.waiting !== null) {
    return { headline: 'Waiting for the lock', tone: 'waiting', cmd: i.waiting.cmd, detail: duration(i.now - i.waiting.since) }
  }
  if (i.snapshot === null) return { headline: 'Reading the GPU…', tone: 'unknown', ...none }
  const { lock } = i.snapshot
  if (lock.kind === 'free') return { headline: 'Free', tone: 'free', ...none }
  if (lock.kind === 'unavailable') return { headline: 'Lock unavailable', tone: 'off', cmd: '', detail: lock.reason }
  if (lock.kind === 'shared') {
    const n = lock.holders.length
    const limit = i.maxPercent === null ? '' : `jobs may use ${i.maxPercent}% of memory together`
    return {
      headline: n === 0 ? 'Shared by an unknown process' : `Shared by ${n} ${n === 1 ? 'job' : 'jobs'}`,
      tone: lock.holders.some(h => isMine(h, i.session)) ? 'mine' : 'other',
      cmd: '',
      detail: limit,
    }
  }
  const { who, mine } = whoOf(lock, i.session)
  const h = lock.holder
  const detail = h === null ? '' : [h.cwd, h.why, duration(i.now - h.since)].filter(p => p !== '').join(' · ')
  return { headline: `Locked by ${who}`, tone: mine ? 'mine' : 'other', cmd: h?.cmd ?? '', detail }
}

const notePart = (gpu: Reading | undefined): string => {
  if (gpu === undefined || gpu.kind === 'ok') return ''
  return gpu.kind === 'none' ? 'No NVIDIA GPU or nvidia-smi found.' : `nvidia-smi failed: ${gpu.message}`
}

export const paneModel = (i: PaneInput): PaneModel => {
  const gpu = i.snapshot?.gpu
  const ok = gpu?.kind === 'ok' ? gpu : null
  return {
    ...lockPart(i),
    enabled: i.enabled,
    gpus: (ok?.gpus ?? []).map(g => ({
      title: `GPU ${g.index}  ${g.name}`,
      bar: bar(g.usedMiB, g.totalMiB, METER_WIDTH),
      used: ratio(g.usedMiB, g.totalMiB),
      stats: [g.util === null ? '' : `${g.util}% busy`, g.tempC === null ? '' : `${g.tempC}°C`]
        .filter(s => s !== '')
        .join(' · '),
    })),
    apps: (ok?.apps ?? [])
      .filter(a => a.usedMiB > 0)
      .sort((a, b) => b.usedMiB - a.usedMiB)
      .map(a => ({ name: a.name, mem: gib(a.usedMiB) })),
    running: i.snapshot?.lock.kind === 'shared' ? i.snapshot.lock.holders.map(h => paneJob(h, i)) : [],
    queue: (i.snapshot === null ? [] : waitersOf(i.snapshot)).map((h, n) => paneJob(h, i, n + 1)),
    note: notePart(gpu),
    chart: chartsOf({
      history: i.history,
      now: i.now,
      columns: i.columns ?? 0,
      rows: (ok?.gpus.length ?? 1) > 1 ? CARD_CHART_ROWS : CHART_ROWS,
      capPercent: i.maxPercent,
      session: i.session,
      titles: (ok?.gpus ?? []).map(g => `GPU ${g.index}  ${g.name}`),
    }),
    log: [...i.log]
      .reverse()
      .slice(0, LOG_ROWS)
      .map(e => ({
        icon: ICONS[e.kind],
        text: [e.cmd, e.ms === null ? '' : duration(e.ms), e.note].filter(p => p !== '').join(' · '),
        when: `${duration(i.now - e.at)} ago`,
      })),
    bad: [...i.bad],
  }
}
