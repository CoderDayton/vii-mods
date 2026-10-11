import { oneLine } from './text'

// The call a rule fires on: a tool, and words that must all be in the call. Never a pattern.
export type Trigger = { tool: string; words: string[] }

// A call Claude made: the tool and the arguments the model gave it.
export type Use = { tool: string; input: Record<string, unknown> }

const MAX_WORDS = 4
const MIN_WORD = 2
const MAX_WORD = 40
const MAX_TOOL = 100
const TOKEN = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings)
  return []
}

// The whole words of every string in a call's arguments, lower case.
export const tokensOf = (input: unknown): Set<string> => new Set(strings(input).flatMap(s => s.toLowerCase().match(TOKEN) ?? []))

export const fires = (t: Trigger, tool: string, tokens: ReadonlySet<string>): boolean =>
  t.tool === tool && t.words.every(w => tokens.has(w))

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// One whole word, as `tokensOf` would cut it.
const wordFrom = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const word = raw.toLowerCase()
  const found = word.match(TOKEN) ?? []
  return found.length === 1 && found[0] === word && word.length >= MIN_WORD && word.length <= MAX_WORD ? word : null
}

// A trigger of the right shape, or null. Used for what the store hands back.
export const parseTrigger = (raw: unknown): Trigger | null => {
  if (!isObject(raw) || !Array.isArray(raw['words'])) return null
  const tool = typeof raw['tool'] === 'string' ? raw['tool'].trim() : ''
  if (tool === '' || tool.length > MAX_TOOL) return null
  const words: string[] = []
  for (const item of raw['words']) {
    const word = wordFrom(item)
    if (word === null) return null
    if (!words.includes(word)) words.push(word)
  }
  return words.length === 0 || words.length > MAX_WORDS ? null : { tool, words }
}

// A trigger the model named is taken only when a call Claude just made fires it: it cannot invent one.
export const groundedTrigger = (raw: unknown, uses: readonly Use[]): Trigger | null => {
  const t = parseTrigger(raw)
  if (t === null) return null
  return uses.some(u => fires(t, u.tool, tokensOf(u.input))) ? t : null
}

export const showTrigger = (t: Trigger): string => `${t.tool}: ${t.words.join(' ')}`

export const useLine = (u: Use, max: number): string => oneLine(`${u.tool}: ${strings(u.input).join(' ')}`, max)
