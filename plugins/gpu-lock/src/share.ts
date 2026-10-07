import type { Gpu, Holder } from '../types'

// A job that started less than this long ago may not have allocated its memory yet,
// so its declared need counts as reserved on top of what nvidia-smi shows.
export const RAMP_SECONDS = 30

export type ShareInput = {
  gpus: readonly Gpu[]
  devices: readonly number[] | null
  need: number
  holders: readonly Holder[]
  now: number
  maxPercent: number
}

export type ShareRoom = {
  ok: boolean
  usedMiB: number
  capMiB: number
  totalMiB: number
  freeMiB: number
  shared: boolean
}

const reservedMiB = (holders: readonly Holder[], now: number): number =>
  holders.reduce((sum, h) => (now - h.since < RAMP_SECONDS * 1000 ? sum + (h.needMiB ?? 0) : sum), 0)

// With other jobs running, the new one must keep the card under the cap.
// Alone on the card, it only has to fit in the free memory.
export const shareRoom = (i: ShareInput): ShareRoom | null => {
  const named = i.devices === null ? [] : i.gpus.filter(g => i.devices?.includes(g.index))
  const pool = named.length > 0 ? named : i.gpus
  const shared = i.holders.length > 0
  const reserved = shared ? reservedMiB(i.holders, i.now) : 0
  let best: (ShareRoom & { slack: number }) | null = null
  for (const g of pool) {
    const capMiB = Math.floor((g.totalMiB * i.maxPercent) / 100)
    const usedMiB = g.usedMiB + reserved
    const freeMiB = g.totalMiB - g.usedMiB
    const slack = shared ? capMiB - usedMiB - i.need : freeMiB - i.need
    if (best === null || slack > best.slack) {
      best = { ok: slack >= 0, usedMiB, capMiB, totalMiB: g.totalMiB, freeMiB, shared, slack }
    }
  }
  if (best === null) return null
  const { slack: _slack, ...room } = best
  return room
}
