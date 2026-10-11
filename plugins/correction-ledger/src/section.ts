import type { Rule } from './rules'

export const MAX_SECTION_CHARS = 2400

const HEADER = 'Standing corrections from this user for this project. Follow them every turn so the user never has to repeat them.'
const BROKEN =
  'Rules marked [broken N×] were ignored before, and the user had to say them again. Check your work against each one before you answer.'

const line = (r: Rule): string => (r.strikes > 0 ? `- [broken ${r.strikes}×] ${r.text}` : `- ${r.text}`)

// Rules that were broken lead, most broken first; the rest follow, most recently used first.
export const ranked = (rules: readonly Rule[]): Rule[] => [...rules].sort((a, b) => b.strikes - a.strikes || b.last - a.last)

const REMIND = 'A standing correction from this user covers the call you just made. Check that what you did follows it, and tell the user if it does not.'
const BLOCK =
  'correction-ledger: this call was stopped. A standing correction from this user covers it, and it was ignored before.'
const RETRY = 'If the call follows the correction, or the user has approved it, make the same call again and it will run. If not, change course or ask the user.'

// What Claude reads after a call a rule fired on.
export const remindNote = (rules: readonly Rule[]): string => [REMIND, ...ranked(rules).map(line)].join('\n')

// What Claude reads in place of a call a broken rule stopped.
export const blockNote = (rules: readonly Rule[]): string => [BLOCK, ...ranked(rules).map(line), RETRY].join('\n')

// The system prompt section for the rules sent every turn, or null when there are none. A rule with a
// trigger is left out: it is sent when it fires.
export const ruleSection = (rules: readonly Rule[]): string | null => {
  const sorted = ranked(rules.filter(r => r.when === undefined))
  if (sorted.length === 0) return null
  const fits = (lines: string[], extra: string[]): string => [HEADER, ...extra, ...lines].join('\n')
  const kept: Rule[] = []
  for (const r of sorted) {
    const extra = [...kept, r].some(k => k.strikes > 0) ? [BROKEN] : []
    if (fits([...kept, r].map(line), extra).length > MAX_SECTION_CHARS) break
    kept.push(r)
  }
  return fits(kept.map(line), kept.some(k => k.strikes > 0) ? [BROKEN] : [])
}
