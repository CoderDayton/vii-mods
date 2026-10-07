import type { App, Gpu } from '../types'
import { clean } from './format'

const APP_NAME_CHARS = 40

export const SMI_GPUS = [
  'nvidia-smi',
  '--query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu,uuid',
  '--format=csv,noheader,nounits',
] as const

export const SMI_APPS = [
  'nvidia-smi',
  '--query-compute-apps=pid,process_name,used_gpu_memory,gpu_uuid',
  '--format=csv,noheader,nounits',
] as const

const UUID = /^(GPU|MIG)-\S+$/

// The uuid is the last field when the driver reports it; an older fixture or driver may not.
const withoutUuid = (parts: string[]): { fields: string[]; uuid: string | undefined } => {
  const last = parts[parts.length - 1]
  return last !== undefined && UUID.test(last)
    ? { fields: parts.slice(0, -1), uuid: clean(last, 80) }
    : { fields: parts, uuid: undefined }
}

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
  for (const line of lines(text)) {
    const { fields: parts, uuid } = withoutUuid(line)
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
      ...(uuid === undefined ? {} : { uuid }),
    })
  }
  return gpus
}

const programName = (raw: string): string => {
  const program = raw.split(/\s-/)[0] ?? raw
  return clean(program.split(/[\\/]/).pop() ?? '', APP_NAME_CHARS)
}

export const parseApps = (text: string): App[] => {
  const apps: App[] = []
  for (const line of lines(text)) {
    const { fields: parts, uuid } = withoutUuid(line)
    if (parts.length < 3) continue
    const pid = num(parts[0])
    if (pid === null) continue
    apps.push({
      pid,
      name: programName(parts.slice(1, parts.length - 1).join(', ')),
      usedMiB: num(parts[parts.length - 1]) ?? 0,
      ...(uuid === undefined ? {} : { gpu: uuid }),
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
