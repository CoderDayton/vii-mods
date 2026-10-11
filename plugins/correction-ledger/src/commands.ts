import { addRule, daysLeft, findSimilar, keepRule, removeRule } from './rules'
import type { Ledger, Lives, Rule } from './rules'
import { MAX_RULE, MIN_RULE } from './judge'
import { oneLine } from './text'
import { showTrigger } from './trigger'

export type Context = { ledger: Ledger; enabled: boolean; now: number; max: number; lives: Lives }
export type Outcome = { text: string; ledger?: Ledger; enabled?: boolean }

const USAGE = 'Usage: /rules [list] | add <rule> | keep <number> | rm <number> | clear | off | on'
const HAND = 'added by hand'
const WORN_OUT = 3

const ago = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

const fate = (r: Rule, c: Context): string => {
  if (r.life === 'kept') return 'kept'
  const left = daysLeft(c.ledger, r, c.lives)
  return `${left} worked ${left === 1 ? 'day' : 'days'} left`
}

const entry = (r: Rule, c: Context): string[] => {
  const mark = r.strikes > 0 ? `[broken ${r.strikes}×] ` : ''
  const said = r.quote === '' ? '' : `“${r.quote}” · `
  const on = r.when === undefined ? '' : ` · fires on ${showTrigger(r.when)}`
  return [`#${r.id}  ${mark}${r.text}`, `    ${said}${ago(c.now - r.at)} · ${fate(r, c)}${on}`]
}

const list = (c: Context): Outcome => {
  const paused = c.enabled ? [] : ['The ledger is paused: nothing is saved or sent. /rules on resumes it.', '']
  if (c.ledger.rules.length === 0) {
    return {
      text: [
        ...paused,
        'No standing corrections for this project yet. Correct Claude ("I said …") and the ledger saves it, or use /rules add <rule>.',
      ].join('\n'),
    }
  }
  const rules = [...c.ledger.rules].sort((a, b) => a.id - b.id)
  const worn = rules
    .filter(r => r.strikes >= WORN_OUT)
    .map(r => `#${r.id} was broken ${r.strikes} times. A reminder is not holding it: put it in CLAUDE.md or a hook.`)
  const lines = [
    ...paused,
    `Standing corrections for this project (${rules.length}):`,
    ...rules.flatMap(r => entry(r, c)),
    ...(worn.length === 0 ? [] : ['', ...worn]),
  ]
  return { text: lines.join('\n') }
}

const add = (rest: string, c: Context): Outcome => {
  const text = oneLine(rest, MAX_RULE)
  const same = findSimilar(c.ledger, text)
  if (same !== null) return { text: `Already saved as #${same.id}: ${same.text}` }
  if (text.length < MIN_RULE) return { text: 'Usage: /rules add <rule>' }
  const ledger = addRule(c.ledger, { text, quote: HAND, now: c.now, life: 'kept' }, c.max)
  const id = ledger.rules[ledger.rules.length - 1]?.id ?? 0
  return { text: `Saved #${id}: ${text}`, ledger }
}

// The rule number a command names, with or without its #.
const idOf = (rest: string): number | null => {
  const m = /^#?(\d+)$/.exec(rest.trim())
  return m === null ? null : Number(m[1])
}

const remove = (rest: string, c: Context): Outcome => {
  const id = idOf(rest)
  if (id === null) return { text: 'Usage: /rules rm <number>' }
  const { ledger, removed } = removeRule(c.ledger, id)
  return removed === null ? { text: `No rule #${id}.` } : { text: `Removed #${id}: ${removed.text}`, ledger }
}

const keep = (rest: string, c: Context): Outcome => {
  const id = idOf(rest)
  if (id === null) return { text: 'Usage: /rules keep <number>' }
  const rule = c.ledger.rules.find(r => r.id === id)
  if (rule === undefined) return { text: `No rule #${id}.` }
  return { text: `Kept #${id}: ${rule.text}`, ledger: keepRule(c.ledger, id) }
}

const clear = (c: Context): Outcome => {
  const n = c.ledger.rules.length
  if (n === 0) return { text: 'Nothing to clear.' }
  return { text: `Cleared ${n} ${n === 1 ? 'rule' : 'rules'}.`, ledger: { ...c.ledger, rules: [] } }
}

export const runRules = (args: string, c: Context): Outcome => {
  const trimmed = args.trim()
  const word = (trimmed.split(/\s+/)[0] ?? '').toLowerCase()
  const rest = trimmed.slice(word.length).trim()
  if (word === '' || word === 'list') return list(c)
  if (word === 'add') return add(rest, c)
  if (word === 'keep') return keep(rest, c)
  if (word === 'rm' || word === 'remove') return remove(rest, c)
  if (word === 'clear') return clear(c)
  if (word === 'off') return { text: 'Correction ledger paused: nothing is saved or sent until /rules on.', enabled: false }
  if (word === 'on') return { text: 'Correction ledger on.', enabled: true }
  return { text: USAGE }
}
