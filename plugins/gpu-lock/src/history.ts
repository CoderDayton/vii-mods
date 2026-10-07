import type { CardSample, Holder, LockState, Sample, Snapshot } from '../types'
import { clean, gib, ratio, shortId } from './format'
import { jobOf } from './procs'

export type { Sample } from '../types'

export const SPAN_MS = 600_000
export const MAX_SAMPLES = 400
export const PALETTE_SIZE = 5
// Samples closer together than this are one: sessions that poll at once write one between them.
export const MIN_GAP_MS = 2000

const MIN_COLUMNS = 8
const LEVELS = 8
const BLOCKS = ' ▁▂▃▄▅▆▇█'
const CAP_MARK = '╌'
const LABEL_WIDTH = 4
const MAX_CARDS = 16
const MAX_JOBS = 32
const SESSION_CHARS = 64
const CMD_CHARS = 60
const FUTURE_MS = 60_000
const JOB_KEY = /^\d{1,10}$/

const holdersOf = (lock: LockState): Holder[] => {
  if (lock.kind === 'shared') return lock.holders
  return lock.kind === 'held' && lock.holder !== null ? [lock.holder] : []
}

// A process counts on the card its uuid names; with one card and no uuid it can only be that one.
const cardOf = (app: { gpu?: string }, gpus: readonly { uuid?: string }[]): number | null => {
  if (app.gpu === undefined) return gpus.length === 1 ? 0 : null
  const i = gpus.findIndex(g => g.uuid === app.gpu)
  return i < 0 ? null : i
}

// The process tree is only worth a `ps` while a job holds the lock and the card has processes to place.
export const needsTree = (snap: Snapshot): boolean =>
  snap.gpu.kind === 'ok' && snap.gpu.apps.length > 0 && holdersOf(snap.lock).length > 0

const sum = (jobs: Record<string, number>): number => Object.values(jobs).reduce((a, b) => a + b, 0)

// Every card as one point in time, and the memory each running job's processes hold on it.
export const sampleOf = (snap: Snapshot, parents: ReadonlyMap<number, number> | null): Sample | null => {
  if (snap.gpu.kind !== 'ok' || snap.gpu.gpus.length === 0) return null
  const { gpus, apps } = snap.gpu
  const holders = holdersOf(snap.lock)
  const pids = new Set(holders.map(h => h.pid))
  const cards: CardSample[] = gpus.map(g => ({ usedMiB: g.usedMiB, totalMiB: g.totalMiB, jobs: {} }))
  const meta: Sample['jobs'] = {}
  if (parents !== null && holders.length > 0) {
    for (const app of apps) {
      const card = cards[cardOf(app, gpus) ?? -1]
      const pid = jobOf(app.pid, pids, parents)
      if (card === undefined || pid === null || app.usedMiB <= 0) continue
      const add = Math.min(app.usedMiB, Math.max(0, card.usedMiB - sum(card.jobs)))
      if (add <= 0) continue
      const key = String(pid)
      card.jobs[key] = (card.jobs[key] ?? 0) + add
      const h = holders.find(x => x.pid === pid)
      if (h !== undefined) meta[key] = { session: clean(h.session, SESSION_CHARS), cmd: clean(h.cmd, CMD_CHARS) }
    }
  }
  return { at: snap.at, gpus: cards, jobs: meta }
}

export const sampleLine = (s: Sample): string => JSON.stringify(s)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

const cardFrom = (raw: unknown): CardSample | null => {
  if (!isObject(raw)) return null
  const used = count(raw['usedMiB'])
  const total = count(raw['totalMiB'])
  if (used === null || total === null || total <= 0) return null
  const jobs: Record<string, number> = {}
  if (isObject(raw['jobs'])) {
    for (const [key, v] of Object.entries(raw['jobs']).slice(0, MAX_JOBS)) {
      const mib = count(v)
      if (JOB_KEY.test(key) && mib !== null) jobs[key] = mib
    }
  }
  return { usedMiB: used, totalMiB: total, jobs }
}

const sampleFrom = (raw: unknown): Sample | null => {
  if (!isObject(raw)) return null
  const at = raw['at']
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null
  if (!Array.isArray(raw['gpus']) || raw['gpus'].length === 0 || raw['gpus'].length > MAX_CARDS) return null
  const gpus: CardSample[] = []
  for (const c of raw['gpus']) {
    const card = cardFrom(c)
    if (card === null) return null
    gpus.push(card)
  }
  const jobs: Sample['jobs'] = {}
  if (isObject(raw['jobs'])) {
    for (const [key, v] of Object.entries(raw['jobs']).slice(0, MAX_JOBS)) {
      if (!JOB_KEY.test(key) || !isObject(v)) continue
      const session = typeof v['session'] === 'string' ? clean(v['session'], SESSION_CHARS) : ''
      const cmd = typeof v['cmd'] === 'string' ? clean(v['cmd'], CMD_CHARS) : ''
      jobs[key] = { session, cmd }
    }
  }
  return { at, gpus, jobs }
}

// The shared file may hold anything, so each line is checked; a line that is not a sample is skipped.
export const parseSamples = (text: string, now: number): Sample[] => {
  const out: Sample[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const s = sampleFrom(JSON.parse(line))
      if (s !== null && s.at >= now - SPAN_MS && s.at <= now + FUTURE_MS) out.push(s)
    } catch {
      continue
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX_SAMPLES)
}

// What a cell is drawn in: a job's palette slot, or one of the plain kinds.
export type Paint = 'blank' | 'cap' | 'other' | number
export type ChartRun = { text: string; fg: Paint; bg: Paint | null }
export type ChartCard = { title: string; summary: string; rows: { label: string; runs: ChartRun[] }[] }
export type LegendItem = { paint: Paint; label: string; mem: string }
export type Charts = { cards: ChartCard[]; axis: string; legend: LegendItem[] }

export type ChartInput = {
  history: readonly Sample[] | undefined
  now: number
  columns: number
  rows: number
  capPercent: number | null
  session: string
  titles: readonly string[]
}

type Segment = { paint: Paint; upTo: number }

const axisOf = (columns: number): string => {
  const left = `${SPAN_MS / 60_000}m ago`
  const right = 'now'
  const gap = columns - left.length - right.length
  const body = gap >= 1 ? `${left}${' '.repeat(gap)}${right}` : right.padStart(columns)
  return ' '.repeat(LABEL_WIDTH + 1) + body
}

// Jobs take palette slots in the order they first show memory, so a job keeps its colour along the span.
const rankJobs = (history: readonly Sample[]): Map<string, number> => {
  const rank = new Map<string, number>()
  for (const s of history) {
    for (const card of s.gpus) {
      for (const key of Object.keys(card.jobs).sort((a, b) => Number(a) - Number(b))) {
        if ((card.jobs[key] ?? 0) > 0 && !rank.has(key)) rank.set(key, rank.size)
      }
    }
  }
  return rank
}

const stack = (card: CardSample, levels: number, rank: ReadonlyMap<string, number>): { used: number; segs: Segment[] } => {
  const share = (mib: number) => Math.round(Math.min(1, mib / card.totalMiB) * levels)
  const used = card.usedMiB <= 0 ? 0 : Math.max(1, share(card.usedMiB))
  const segs: Segment[] = []
  let covered = 0
  let mib = 0
  const keys = Object.keys(card.jobs)
    .filter(k => (card.jobs[k] ?? 0) > 0 && rank.has(k))
    .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  for (const key of keys) {
    mib += card.jobs[key] ?? 0
    const upTo = Math.min(used, share(mib))
    if (upTo > covered) segs.push({ paint: (rank.get(key) ?? 0) % PALETTE_SIZE, upTo })
    covered = Math.max(covered, upTo)
  }
  if (used > covered) segs.push({ paint: 'other', upTo: used })
  return { used, segs }
}

// One character cell of a stacked column. A cell holding two jobs takes the lower as its glyph and the upper as its background.
const cellOf = (segs: readonly Segment[], used: number, lo: number): { text: string; fg: Paint; bg: Paint | null } | null => {
  if (used <= lo) return null
  const at = (level: number) => segs.find(s => s.upTo > level)?.paint ?? 'other'
  const top = Math.min(used, lo + LEVELS)
  const first = segs.find(s => s.upTo > lo)
  const edge = Math.min(first?.upTo ?? top, top)
  const lower = at(lo)
  if (edge >= top) return { text: BLOCKS[top - lo] ?? ' ', fg: lower, bg: null }
  if (top < lo + LEVELS) {
    const paint = edge - lo >= top - edge ? lower : at(top - 1)
    return { text: BLOCKS[top - lo] ?? ' ', fg: paint, bg: null }
  }
  return { text: BLOCKS[edge - lo] ?? ' ', fg: lower, bg: at(top - 1) }
}

const labelOf = (meta: { session: string; cmd: string } | undefined, session: string): string => {
  const who = meta === undefined ? 'session ?' : meta.session === session ? 'this session' : `session ${shortId(meta.session) || '?'}`
  return [who, meta?.cmd ?? ''].filter(p => p !== '').join(' · ')
}

const legendOf = (latest: Sample, rank: ReadonlyMap<string, number>, session: string): LegendItem[] => {
  const mib = new Map<string, number>()
  for (const card of latest.gpus) {
    for (const [key, v] of Object.entries(card.jobs)) if (v > 0 && rank.has(key)) mib.set(key, (mib.get(key) ?? 0) + v)
  }
  const items = [...mib.entries()]
    .sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0))
    .map(([key, v]) => ({
      paint: ((rank.get(key) ?? 0) % PALETTE_SIZE) as Paint,
      label: labelOf(latest.jobs[key], session),
      mem: gib(v),
    }))
  if (items.length === 0) return []
  const used = latest.gpus.reduce((s, c) => s + c.usedMiB, 0)
  const rest = used - [...mib.values()].reduce((s, v) => s + v, 0)
  return rest > 0 ? [...items, { paint: 'other', label: 'other processes', mem: gib(rest) }] : items
}

export const chartsOf = (i: ChartInput): Charts | null => {
  if (i.columns < MIN_COLUMNS) return null
  const inSpan = (i.history ?? []).filter(s => s.at >= i.now - SPAN_MS)
  const latest = inSpan[inSpan.length - 1]
  if (latest === undefined || latest.gpus.length === 0) return null

  const rank = rankJobs(inSpan)
  const levels = i.rows * LEVELS
  const capLevel = i.capPercent === null ? null : Math.max(1, Math.round((i.capPercent / 100) * levels))
  const capRow = capLevel === null ? -1 : i.rows - 1 - Math.floor((capLevel - 1) / LEVELS)
  const start = i.now - SPAN_MS

  const cards = latest.gpus.map((_, c): ChartCard => {
    // Each column shows the fullest sample of its slice of time, with that sample's own stacking.
    const picks: (CardSample | null)[] = Array.from({ length: i.columns }, () => null)
    let peak = 0
    let newest: CardSample | null = null
    for (const s of inSpan) {
      const card = s.gpus[c]
      if (card === undefined) continue
      peak = Math.max(peak, card.usedMiB)
      newest = card
      const col = Math.min(i.columns - 1, Math.floor(((s.at - start) / SPAN_MS) * i.columns))
      const held = picks[col]
      if (held === null || held === undefined || card.usedMiB / card.totalMiB > held.usedMiB / held.totalMiB) picks[col] = card
    }
    const stacks = picks.map(p => (p === null || p === undefined ? null : stack(p, levels, rank)))

    const rows = Array.from({ length: i.rows }, (_, r) => {
      const lo = (i.rows - 1 - r) * LEVELS
      const runs: ChartRun[] = []
      for (const st of stacks) {
        const filled = st === null ? null : cellOf(st.segs, st.used, lo)
        const cell: ChartRun =
          filled ?? (r === capRow ? { text: CAP_MARK, fg: 'cap', bg: null } : { text: ' ', fg: 'blank', bg: null })
        const last = runs[runs.length - 1]
        if (last !== undefined && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
        else runs.push(cell)
      }
      const label = r === 0 ? '100%' : r === capRow ? `${i.capPercent}%` : r === i.rows - 1 ? '0%' : ''
      return { label: label.padStart(LABEL_WIDTH), runs }
    })

    return {
      title: latest.gpus.length === 1 ? 'GPU memory' : (i.titles[c] ?? `GPU ${c}`),
      summary: newest === null ? '' : `now ${ratio(newest.usedMiB, newest.totalMiB)} · peak ${gib(peak)}`,
      rows,
    }
  })

  return { cards, axis: axisOf(i.columns), legend: legendOf(latest, rank, i.session) }
}
