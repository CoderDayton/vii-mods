export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Config = { model: string; effort: Effort; timeoutMs: number; autoAccept: boolean }

const DEFAULT_MODEL = 'haiku'
const DEFAULT_EFFORT: Effort = 'high'
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_SECONDS = 20
const MIN_SECONDS = 5
const MAX_SECONDS = 120

const seconds = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SECONDS
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.floor(value)))
}

const effort = (value: unknown): Effort => {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return EFFORTS.find(e => e === level) ?? DEFAULT_EFFORT
}

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const model = typeof o['model'] === 'string' ? o['model'].trim() : ''
  return {
    model: model === '' ? DEFAULT_MODEL : model,
    effort: effort(o['effort']),
    timeoutMs: seconds(o['timeoutSeconds']) * 1000,
    autoAccept: o['autoAccept'] !== false,
  }
}
