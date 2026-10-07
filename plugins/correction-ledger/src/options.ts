export type Config = { model: string; maxRules: number; timeoutMs: number }

const DEFAULT_MODEL = 'haiku'
const DEFAULT_RULES = 12
const MIN_RULES = 3
const MAX_RULES = 30
const DEFAULT_SECONDS = 15
const MIN_SECONDS = 5
const MAX_SECONDS = 60

const clamped = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const model = typeof o['model'] === 'string' ? o['model'].trim() : ''
  return {
    model: model === '' ? DEFAULT_MODEL : model,
    maxRules: clamped(o['maxRules'], DEFAULT_RULES, MIN_RULES, MAX_RULES),
    timeoutMs: clamped(o['timeoutSeconds'], DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS) * 1000,
  }
}
