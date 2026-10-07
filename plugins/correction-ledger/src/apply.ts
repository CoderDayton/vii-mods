import type { Verdict } from './judge'
import { addRule, findSimilar, replaceRule, strikeRule } from './rules'
import type { Ledger } from './rules'

const PREFIX = 'correction-ledger:'

export type Applied = { ledger: Ledger; note: string | null }

type When = { quote: string; now: number; max: number }

const broken = (l: Ledger, id: number): string => {
  const rule = l.rules.find(r => r.id === id)
  return `${PREFIX} rule #${id} broken again (${rule?.strikes ?? 0}×): ${rule?.text ?? ''}`
}

const saved = (l: Ledger, text: string, when: When): Applied => {
  const next = addRule(l, { text, quote: when.quote, now: when.now }, when.max)
  const id = next.rules[next.rules.length - 1]?.id ?? 0
  return { ledger: next, note: `${PREFIX} saved rule #${id}: ${text} (/rules rm ${id} to undo)` }
}

// Puts a verdict into the ledger. A rule the user had to say again is a strike on the saved one, never a copy.
export const applyVerdict = (l: Ledger, v: Verdict, when: When): Applied => {
  if (v.kind === 'none') return { ledger: l, note: null }
  if (v.kind === 'repeat') {
    if (!l.rules.some(r => r.id === v.id)) return { ledger: l, note: null }
    const next = strikeRule(l, v.id, when.now)
    return { ledger: next, note: broken(next, v.id) }
  }
  if (v.kind === 'replace' && l.rules.some(r => r.id === v.id)) {
    const next = replaceRule(l, v.id, { text: v.text, quote: when.quote, now: when.now })
    return { ledger: next, note: `${PREFIX} updated rule #${v.id}: ${v.text}` }
  }
  const same = findSimilar(l, v.text)
  if (same === null) return saved(l, v.text, when)
  const next = strikeRule(l, same.id, when.now)
  return { ledger: next, note: broken(next, same.id) }
}
