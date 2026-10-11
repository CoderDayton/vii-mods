import { oneLine, wordsOf } from './text'
import { isObject, parseTrigger } from './trigger'
import type { Trigger } from './trigger'

// How long a rule is for: the job in hand, the project, or until the user removes it.
export type Life = 'task' | 'project' | 'kept'

// The worked days a rule of each life lasts when nobody repeats it.
export type Lives = { task: number; project: number }

export type Rule = {
  id: number
  text: string
  quote: string
  at: number
  last: number
  strikes: number
  life: Life
  // The ledger's count of worked days when the rule was saved, repeated, changed or fired.
  seen: number
  // The call the rule fires on. A rule with one is sent when it fires, not every turn.
  when?: Trigger
}

// `days` counts the days the project was worked on; `day` is the calendar day last counted.
export type Ledger = { next: number; rules: Rule[]; days: number; day: number }

export const MAX_TEXT = 200
export const MAX_QUOTE = 160
const MAX_STORED = 60
const SAME_RULE = 0.7
const DAY_MS = 86_400_000

export const emptyLedger = (): Ledger => ({ next: 1, rules: [], days: 0, day: 0 })

type Draft = { text: string; quote: string; now: number; life: Life; when?: Trigger }

// A calendar day the project is worked on counts once. Days away do not count.
const stamp = (l: Ledger, now: number): Ledger => {
  const day = Math.floor(now / DAY_MS)
  return day > l.day ? { ...l, day, days: l.days + 1 } : l
}

// Each break buys a rule its life again.
const lifetime = (r: Rule, lives: Lives): number => (r.life === 'kept' ? Infinity : lives[r.life] * (1 + r.strikes))

// Worked days a rule has left, today included.
export const daysLeft = (l: Ledger, r: Rule, lives: Lives): number => Math.max(0, lifetime(r, lives) - (l.days - r.seen))

// Counts today and drops the rules that ran out.
export const tick = (l: Ledger, now: number, lives: Lives): { ledger: Ledger; expired: Rule[] } => {
  const aged = stamp(l, now)
  const expired = aged.rules.filter(r => daysLeft(aged, r, lives) === 0)
  if (expired.length === 0) return { ledger: aged, expired }
  return { ledger: { ...aged, rules: aged.rules.filter(r => !expired.includes(r)) }, expired }
}

// Past the cap a rule that is not kept goes first: the one broken least often, the longest unused. The new rule is never the one.
const evict = (rules: Rule[], keep: number, max: number): Rule[] => {
  const out = [...rules]
  while (out.length > max) {
    const gone = out
      .filter(r => r.id !== keep)
      .sort((a, b) => Number(a.life === 'kept') - Number(b.life === 'kept') || a.strikes - b.strikes || a.last - b.last)[0]
    if (gone === undefined) break
    out.splice(out.indexOf(gone), 1)
  }
  return out
}

export const addRule = (from: Ledger, d: Draft, max: number): Ledger => {
  const l = stamp(from, d.now)
  const rule: Rule = {
    id: l.next,
    text: oneLine(d.text, MAX_TEXT),
    quote: oneLine(d.quote, MAX_QUOTE),
    at: d.now,
    last: d.now,
    strikes: 0,
    life: d.life,
    seen: l.days,
    ...(d.when === undefined ? {} : { when: d.when }),
  }
  return { ...l, next: l.next + 1, rules: evict([...l.rules, rule], rule.id, max) }
}

const withRule = (l: Ledger, id: number, change: (r: Rule) => Rule): Ledger =>
  l.rules.some(r => r.id === id) ? { ...l, rules: l.rules.map(r => (r.id === id ? change(r) : r)) } : l

// The user had to say it again: one more break, and the rule counts as just used.
export const strikeRule = (l: Ledger, id: number, now: number): Ledger =>
  withRule(l, id, r => ({ ...r, strikes: r.strikes + 1, last: now, seen: l.days }))

// The rule keeps the life it had. Its trigger is the draft's: new text with no trigger is sent every turn.
export const replaceRule = (l: Ledger, id: number, d: Draft): Ledger =>
  withRule(l, id, ({ when: _old, ...r }) => ({
    ...r,
    text: oneLine(d.text, MAX_TEXT),
    quote: oneLine(d.quote, MAX_QUOTE),
    last: d.now,
    seen: l.days,
    ...(d.when === undefined ? {} : { when: d.when }),
  }))

// The rule fired: it counts as seen today. The same ledger comes back when it already does.
export const touchRule = (l: Ledger, id: number): Ledger =>
  l.rules.some(r => r.id === id && r.seen < l.days) ? withRule(l, id, r => ({ ...r, seen: l.days })) : l

export const keepRule = (l: Ledger, id: number): Ledger => withRule(l, id, r => ({ ...r, life: 'kept' }))

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

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

const ruleFrom = (raw: unknown): Rule | null => {
  if (!isObject(raw)) return null
  const id = raw['id']
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  const text = typeof raw['text'] === 'string' ? oneLine(raw['text'], MAX_TEXT) : ''
  if (text === '') return null
  const quote = typeof raw['quote'] === 'string' ? oneLine(raw['quote'], MAX_QUOTE) : ''
  const life: Life = raw['life'] === 'task' || raw['life'] === 'kept' ? raw['life'] : 'project'
  const when = parseTrigger(raw['when'])
  const rule: Rule = { id, text, quote, at: count(raw['at']), last: count(raw['last']), strikes: count(raw['strikes']), life, seen: count(raw['seen']) }
  return when === null ? rule : { ...rule, when }
}

// What the store hands back may be anything: keep the rules that are whole, and keep ids moving forward.
export const parseLedger = (raw: unknown): Ledger => {
  if (!isObject(raw) || !Array.isArray(raw['rules'])) return emptyLedger()
  const days = count(raw['days'])
  const rules: Rule[] = []
  for (const item of raw['rules'].slice(0, MAX_STORED)) {
    const r = ruleFrom(item)
    if (r !== null && !rules.some(x => x.id === r.id)) rules.push({ ...r, seen: Math.min(r.seen, days) })
  }
  const next = Math.max(count(raw['next']), 1, ...rules.map(r => r.id + 1))
  return { next, rules, days, day: count(raw['day']) }
}
