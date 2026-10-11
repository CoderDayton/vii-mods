import type { Lives } from './rules'

export type Config = { model: string; maxRules: number; timeoutMs: number; lives: Lives }

const DEFAULT_MODEL = 'haiku'
const DEFAULT_RULES = 12
const MIN_RULES = 3
const MAX_RULES = 30
const DEFAULT_SECONDS = 15
const MIN_SECONDS = 5
const MAX_SECONDS = 60
const DEFAULT_TASK_DAYS = 2
const MIN_TASK_DAYS = 1
const MAX_TASK_DAYS = 14
const DEFAULT_RULE_DAYS = 14
const MIN_RULE_DAYS = 3
const MAX_RULE_DAYS = 90

const clamped = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const model = typeof o['model'] === 'string' ? o['model'].trim() : ''
  return {
    model: model === '' ? DEFAULT_MODEL : model,
    maxRules: clamped(o['maxRules'], DEFAULT_RULES, MIN_RULES, MAX_RULES),
    timeoutMs: clamped(o['timeoutSeconds'], DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS) * 1000,
    lives: {
      task: clamped(o['taskDays'], DEFAULT_TASK_DAYS, MIN_TASK_DAYS, MAX_TASK_DAYS),
      project: clamped(o['ruleDays'], DEFAULT_RULE_DAYS, MIN_RULE_DAYS, MAX_RULE_DAYS),
    },
  }
}
