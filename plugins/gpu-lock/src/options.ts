import { compilePatterns } from './classify'

export const DEFAULT_LOCK_PATH = '/tmp/gpu-lock/lock'

export type Band = 'auto' | 'always' | 'never'

export type Mode = 'exclusive' | 'shared'

export type Config = {
  mode: Mode
  maxVramPercent: number
  waitSeconds: number
  minFreeMiB: number
  band: Band
  lockPath: string
  extra: RegExp[]
  skip: RegExp[]
  bad: string[]
}

const whole = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

const lines = (value: unknown): string => (typeof value === 'string' ? value : '')

const isLockPath = (value: unknown): value is string =>
  typeof value === 'string' && /^\/[^\0\r\n]*[^/\0\r\n]$/.test(value)

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const extra = compilePatterns(lines(o['extraPatterns']))
  const skip = compilePatterns(lines(o['skipPatterns']))
  const band = o['band']
  return {
    mode: o['mode'] === 'shared' ? 'shared' : 'exclusive',
    maxVramPercent: whole(o['maxVramPercent'], 10, 100, 75),
    waitSeconds: whole(o['waitSeconds'], 0, 600, 0),
    minFreeMiB: whole(o['minFreeMiB'], 0, 1048576, 1024),
    band: band === 'always' || band === 'never' ? band : 'auto',
    lockPath: isLockPath(o['lockPath']) ? o['lockPath'] : DEFAULT_LOCK_PATH,
    extra: extra.regexes,
    skip: skip.regexes,
    bad: [...extra.bad, ...skip.bad],
  }
}
