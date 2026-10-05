import type { App, Gpu } from '../types'

export const SMI_GPUS = [
  'nvidia-smi',
  '--query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu',
  '--format=csv,noheader,nounits',
] as const

export const SMI_APPS = [
  'nvidia-smi',
  '--query-compute-apps=pid,process_name,used_gpu_memory',
  '--format=csv,noheader,nounits',
] as const

const num = (field: string | undefined): number | null => {
  const n = Number((field ?? '').trim())
  return /^\d+(\.\d+)?$/.test((field ?? '').trim()) && Number.isFinite(n) ? n : null
}

const lines = (text: string): string[][] =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
    .map(l => l.split(',').map(f => f.trim()))

export const parseGpus = (text: string): Gpu[] => {
  const gpus: Gpu[] = []
  for (const parts of lines(text)) {
    if (parts.length < 6) continue
    const index = num(parts[0])
    const usedMiB = num(parts[parts.length - 4])
    const totalMiB = num(parts[parts.length - 3])
    if (index === null || usedMiB === null || totalMiB === null) continue
    gpus.push({
      index,
      name: parts.slice(1, parts.length - 4).join(', '),
      usedMiB,
      totalMiB,
      util: num(parts[parts.length - 2]),
      tempC: num(parts[parts.length - 1]),
    })
  }
  return gpus
}

export const parseApps = (text: string): App[] => {
  const apps: App[] = []
  for (const parts of lines(text)) {
    if (parts.length !== 3) continue
    const pid = num(parts[0])
    if (pid === null) continue
    apps.push({
      pid,
      name: (parts[1] ?? '').split('/').pop() ?? '',
      usedMiB: num(parts[2]) ?? 0,
    })
  }
  return apps
}

export const headroom = (
  gpus: readonly Gpu[],
  devices: readonly number[] | null,
): { freeMiB: number; totalMiB: number } | null => {
  const named = devices === null ? [] : gpus.filter(g => devices.includes(g.index))
  const pool = named.length > 0 ? named : gpus
  let best: { freeMiB: number; totalMiB: number } | null = null
  for (const g of pool) {
    const free = g.totalMiB - g.usedMiB
    if (best === null || free > best.freeMiB) best = { freeMiB: free, totalMiB: g.totalMiB }
  }
  return best
}
