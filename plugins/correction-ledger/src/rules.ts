import { oneLine, wordsOf } from './text'

export type Rule = {
  id: number
  text: string
  quote: string
  at: number
  last: number
  strikes: number
}

export type Ledger = { next: number; rules: Rule[] }

export const MAX_TEXT = 200
export const MAX_QUOTE = 160
const MAX_STORED = 60
const SAME_RULE = 0.7

export const emptyLedger = (): Ledger => ({ next: 1, rules: [] })

type Draft = { text: string; quote: string; now: number }

// Past the cap the rule broken least often goes, the longest unused first; the new rule is never the one.
const evict = (rules: Rule[], keep: number, max: number): Rule[] => {
  const out = [...rules]
  while (out.length > max) {
    const gone = out
      .filter(r => r.id !== keep)
      .sort((a, b) => a.strikes - b.strikes || a.last - b.last)[0]
    if (gone === undefined) break
    out.splice(out.indexOf(gone), 1)
  }
  return out
}

export const addRule = (l: Ledger, d: Draft, max: number): Ledger => {
  const rule: Rule = {
    id: l.next,
    text: oneLine(d.text, MAX_TEXT),
    quote: oneLine(d.quote, MAX_QUOTE),
    at: d.now,
    last: d.now,
    strikes: 0,
  }
  return { next: l.next + 1, rules: evict([...l.rules, rule], rule.id, max) }
}

const withRule = (l: Ledger, id: number, change: (r: Rule) => Rule): Ledger =>
  l.rules.some(r => r.id === id) ? { ...l, rules: l.rules.map(r => (r.id === id ? change(r) : r)) } : l

// The user had to say it again: one more break, and the rule counts as just used.
export const strikeRule = (l: Ledger, id: number, now: number): Ledger =>
  withRule(l, id, r => ({ ...r, strikes: r.strikes + 1, last: now }))

export const replaceRule = (l: Ledger, id: number, d: Draft): Ledger =>
  withRule(l, id, r => ({ ...r, text: oneLine(d.text, MAX_TEXT), quote: oneLine(d.quote, MAX_QUOTE), last: d.now }))

export const removeRule = (l: Ledger, id: number): { ledger: Ledger; removed: Rule | null } => {
  const removed = l.rules.find(r => r.id === id) ?? null
  return { ledger: removed === null ? l : { ...l, rules: l.rules.filter(r => r.id !== id) }, removed }
}

const overlap = (a: readonly string[], b: readonly string[]): number => {
  const x = new Set(a)
  const y = new Set(b)
  const shared = [...x].filter(w => y.has(w)).length
  const all = new Set([...x, ...y]).size
  return all === 0 ? 0 : shared / all
}

// The saved rule that says what this text says, if any.
export const findSimilar = (l: Ledger, text: string): Rule | null => {
  const words = wordsOf(text)
  if (words.length === 0) return null
  return l.rules.find(r => overlap(wordsOf(r.text), words) >= SAME_RULE) ?? null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

const ruleFrom = (raw: unknown): Rule | null => {
  if (!isObject(raw)) return null
  const id = raw['id']
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  const text = typeof raw['text'] === 'string' ? oneLine(raw['text'], MAX_TEXT) : ''
  if (text === '') return null
  const quote = typeof raw['quote'] === 'string' ? oneLine(raw['quote'], MAX_QUOTE) : ''
  return { id, text, quote, at: count(raw['at']), last: count(raw['last']), strikes: count(raw['strikes']) }
}

// What the store hands back may be anything: keep the rules that are whole, and keep ids moving forward.
export const parseLedger = (raw: unknown): Ledger => {
  if (!isObject(raw) || !Array.isArray(raw['rules'])) return emptyLedger()
  const rules: Rule[] = []
  for (const item of raw['rules'].slice(0, MAX_STORED)) {
    const r = ruleFrom(item)
    if (r !== null && !rules.some(x => x.id === r.id)) rules.push(r)
  }
  const next = Math.max(count(raw['next']), 1, ...rules.map(r => r.id + 1))
  return { next, rules }
}
