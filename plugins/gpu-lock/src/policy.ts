import type { Holder, LockState, Reading } from '../types'
import type { Verdict } from './classify'
import { headroom } from './gpu'
import type { Mode } from './options'
import { shareRoom } from './share'

export type Input = {
  verdict: Verdict
  lock: LockState
  gpu: Reading
  minFreeMiB: number
  waitSeconds: number
  mode: Mode
  maxPercent: number
  now: number
  waiters: Holder[]
}

export type Decision =
  | { kind: 'pass'; reason: 'not-gpu' | 'unavailable' }
  | { kind: 'refuse-busy'; holders: Holder[] }
  | { kind: 'refuse-queue'; waiters: Holder[] }
  | { kind: 'refuse-memory'; needMiB: number; freeMiB: number; totalMiB: number }
  | {
      kind: 'refuse-share'
      needMiB: number
      usedMiB: number
      capMiB: number
      totalMiB: number
      percent: number
      holders: Holder[]
    }
  | { kind: 'run'; waits: boolean; freeMiB: number | null; totalMiB: number | null }

const UNKNOWN = { kind: 'run', waits: false, freeMiB: null, totalMiB: null } as const
const QUEUED = { kind: 'run', waits: true, freeMiB: null, totalMiB: null } as const

const holdersOf = (lock: LockState): Holder[] => {
  if (lock.kind === 'shared') return lock.holders
  if (lock.kind === 'held') return lock.holder === null ? [] : [lock.holder]
  return []
}

const decideShared = (input: Input, holders: Holder[]): Decision => {
  const { verdict, gpu } = input
  if (gpu.kind !== 'ok' || gpu.gpus.length === 0) return UNKNOWN
  const need = verdict.gpu ? (verdict.needMiB ?? input.minFreeMiB) : 0
  const room = shareRoom({
    gpus: gpu.gpus,
    devices: verdict.gpu ? verdict.devices : null,
    need,
    holders,
    now: input.now,
    maxPercent: input.maxPercent,
  })
  if (room === null) return UNKNOWN
  if (room.ok) return { kind: 'run', waits: false, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
  if (input.waitSeconds > 0) return QUEUED
  if (!room.shared) {
    return { kind: 'refuse-memory', needMiB: need, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
  }
  return {
    kind: 'refuse-share',
    needMiB: need,
    usedMiB: room.usedMiB,
    capMiB: room.capMiB,
    totalMiB: room.totalMiB,
    percent: input.maxPercent,
    holders,
  }
}

export const decide = (input: Input): Decision => {
  const { verdict, lock, gpu } = input
  if (!verdict.gpu) return { kind: 'pass', reason: 'not-gpu' }
  if (lock.kind === 'unavailable') return { kind: 'pass', reason: 'unavailable' }
  const busy = lock.kind === 'held' || (lock.kind === 'shared' && input.mode === 'exclusive')
  if (busy) {
    if (input.waitSeconds === 0) return { kind: 'refuse-busy', holders: holdersOf(lock) }
    return QUEUED
  }
  // The line is first in, first out: a new job never starts ahead of one that already waits.
  if (input.waiters.length > 0) {
    return input.waitSeconds === 0 ? { kind: 'refuse-queue', waiters: input.waiters } : QUEUED
  }
  if (input.mode === 'shared') return decideShared(input, holdersOf(lock))
  const room = gpu.kind === 'ok' ? headroom(gpu.gpus, verdict.devices) : null
  if (room === null) return UNKNOWN
  const need = verdict.needMiB ?? input.minFreeMiB
  if (need > 0 && room.freeMiB < need) {
    return { kind: 'refuse-memory', needMiB: need, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
  }
  return { kind: 'run', waits: false, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
}
