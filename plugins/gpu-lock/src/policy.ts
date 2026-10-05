import type { Holder, LockState, Reading } from '../types'
import type { Verdict } from './classify'
import { headroom } from './gpu'

export type Input = {
  verdict: Verdict
  lock: LockState
  gpu: Reading
  minFreeMiB: number
  waitSeconds: number
}

export type Decision =
  | { kind: 'pass'; reason: 'not-gpu' | 'unavailable' }
  | { kind: 'refuse-busy'; holder: Holder | null }
  | { kind: 'refuse-memory'; needMiB: number; freeMiB: number; totalMiB: number }
  | { kind: 'run'; waits: boolean; freeMiB: number | null; totalMiB: number | null }

export const decide = (input: Input): Decision => {
  const { verdict, lock, gpu } = input
  if (!verdict.gpu) return { kind: 'pass', reason: 'not-gpu' }
  if (lock.kind === 'unavailable') return { kind: 'pass', reason: 'unavailable' }
  if (lock.kind === 'held') {
    if (input.waitSeconds === 0) return { kind: 'refuse-busy', holder: lock.holder }
    return { kind: 'run', waits: true, freeMiB: null, totalMiB: null }
  }
  const room = gpu.kind === 'ok' ? headroom(gpu.gpus, verdict.devices) : null
  if (room === null) return { kind: 'run', waits: false, freeMiB: null, totalMiB: null }
  const need = verdict.needMiB ?? input.minFreeMiB
  if (need > 0 && room.freeMiB < need) {
    return { kind: 'refuse-memory', needMiB: need, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
  }
  return { kind: 'run', waits: false, freeMiB: room.freeMiB, totalMiB: room.totalMiB }
}
