import { overlaps, protectedSpans } from './text'
import type { Span } from './text'

export type Spoken = { text: string; changed: string[] }

const NOT_A_NAME = new Set(['a', 'an', 'the', 'this', 'that', 'my', 'your', 'our', 'its', 'of', 'no', 'one', 'each'])

const EXTENSIONS = 'md|json|ts|tsx|js|jsx|py|rs|toml|yaml|yml|txt|sh|lock|cfg|ini|csv'

type Rule = { pattern: RegExp; replace: (m: RegExpMatchArray) => string | null }

const RULES: Rule[] = [
  {
    pattern: new RegExp(`(?<![\\w.])([A-Za-z][\\w-]*)\\s+dot\\s+(${EXTENSIONS})(?![\\w.])`, 'gi'),
    replace: m => (NOT_A_NAME.has((m[1] ?? '').toLowerCase()) ? null : `${m[1]}.${m[2]}`),
  },
  {
    pattern: /(?<![\w.])(\d+(?:\.\d+)?)\s*e\s+minus\s+(\d+)(?![\w.])/gi,
    replace: m => `${m[1]}e-${m[2]}`,
  },
  {
    pattern: /(?<![\w.])(\d+)\s+bit(?![\w-])/gi,
    replace: m => `${m[1]}-bit`,
  },
]

type Edit = Span & { to: string; from: string }

export const spokenForms = (text: string): Spoken => {
  const locked = protectedSpans(text)
  const edits: Edit[] = []
  for (const { pattern, replace } of RULES) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0
      const span = { start, end: start + m[0].length }
      const to = replace(m)
      if (to === null || overlaps(span, locked)) continue
      edits.push({ ...span, to, from: m[0] })
    }
  }
  if (edits.length === 0) return { text, changed: [] }

  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let pos = 0
  const changed: string[] = []
  for (const edit of edits) {
    if (edit.start < pos) continue
    out += text.slice(pos, edit.start) + edit.to
    pos = edit.end
    changed.push(edit.from)
  }
  return { text: out + text.slice(pos), changed }
}
