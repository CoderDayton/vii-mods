import type { Entry, Reading, Snapshot, Waiting } from '../types'
import type { Band } from './options'
import { bar, clean, duration, gib, ratio } from './format'
import { isMine, whoLabel } from './messages'

export type Tone = 'mine' | 'other' | 'waiting' | 'free' | 'off'

export type BandModel = {
  tone: Tone
  title: string
  who: string
  cmd: string
  elapsed: string
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

const fit = (model: BandModel, width: number): BandModel => {
  const fixed = 2 + model.title.length + 2 + model.who.length + (model.elapsed === '' ? 0 : 2 + model.elapsed.length) + 2
  const meterWidth = model.meter === null ? 0 : 2 + METER_WIDTH + 1 + model.meter.text.length
  let meter = model.meter
  let budget = width - fixed - meterWidth - 2
  if (budget < MIN_CMD && meter !== null) {
    meter = null
    budget = width - fixed - 2
  }
  return { ...model, meter, cmd: budget < MIN_CMD ? '' : clean(model.cmd, budget) }
}

export const bandModel = (i: BandInput): BandModel | null => {
  if (!i.enabled || i.mode === 'never' || i.snapshot === null) return null
  const { lock, gpu } = i.snapshot
  const meter = meterOf(gpu)

  if (i.waiting !== null) {
    const holder = lock.kind === 'held' ? whoOf(lock, i.session).who : ''
    return fit(
      {
        tone: 'waiting',
        title: 'GPU waiting',
        who: holder === '' ? '' : `held by ${holder}`,
        cmd: i.waiting.cmd,
        elapsed: duration(i.now - i.waiting.since),
        meter,
      },
      i.width,
    )
  }
  if (lock.kind === 'held') {
    const { who, mine } = whoOf(lock, i.session)
    const h = lock.holder
    return fit(
      {
        tone: mine ? 'mine' : 'other',
        title: 'GPU locked',
        who,
        cmd: h?.cmd ?? '',
        elapsed: h === null ? '' : duration(i.now - h.since),
        meter,
      },
      i.width,
    )
  }
  if (i.mode !== 'always') return null
  if (lock.kind === 'unavailable') {
    return fit({ tone: 'off', title: 'GPU lock off', who: '', cmd: lock.reason, elapsed: '', meter: null }, i.width)
  }
  return fit({ tone: 'free', title: 'GPU free', who: '', cmd: '', elapsed: '', meter }, i.width)
}

export const statusLine = (model: BandModel | null): string | undefined =>
  model === null ? undefined : [model.title, model.who, model.cmd, model.elapsed].filter(p => p !== '').join(' · ')

export type PaneModel = {
  headline: string
  tone: Tone | 'unknown'
  cmd: string
  detail: string
  gpus: { title: string; bar: string; used: string; stats: string }[]
  apps: { name: string; mem: string }[]
  note: string
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
}

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
    note: notePart(gpu),
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
