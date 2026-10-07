import type { Rule } from './rules'

export const MAX_SECTION_CHARS = 2400

const HEADER = 'Standing corrections from this user for this project. Follow them every turn so the user never has to repeat them.'
const BROKEN =
  'Rules marked [broken N×] were ignored before, and the user had to say them again. Check your work against each one before you answer.'

const line = (r: Rule): string => (r.strikes > 0 ? `- [broken ${r.strikes}×] ${r.text}` : `- ${r.text}`)

// Rules that were broken lead, most broken first; the rest follow, most recently used first.
export const ranked = (rules: readonly Rule[]): Rule[] => [...rules].sort((a, b) => b.strikes - a.strikes || b.last - a.last)

// The system prompt section for a project's rules, or null when it has none.
export const ruleSection = (rules: readonly Rule[]): string | null => {
  const sorted = ranked(rules)
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
