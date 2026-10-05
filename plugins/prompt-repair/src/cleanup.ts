import { at, overlaps, protectedSpans, tokenize } from './text'
import type { Span } from './text'

export type Cleaned = { text: string; removed: string[] }

const STUTTER = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'for', 'with',
  'is', 'i', 'we', 'can', 'just',
])

const FILLER = /(?<![\w'-])(?:u+m+|u+h+|erm|h+m+)(?![\w'-])/gi
const FILLER_ER = /(?<![\w'-])er(?![\w'-])/g

type Cut = Span & { label: string; capitalizeNext: boolean }

const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t'

const stutterCuts = (text: string, locked: readonly Span[]): Cut[] => {
  const tokens = tokenize(text)
  const cuts: Cut[] = []
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const a = at(tokens, i)
    const b = at(tokens, i + 1)
    if (a.text.toLowerCase() !== b.text.toLowerCase() || !STUTTER.has(a.text.toLowerCase())) continue
    if (!/^[ \t]+$/.test(text.slice(a.end, b.start))) continue
    if (overlaps(a, locked) || overlaps(b, locked)) continue
    cuts.push({ start: a.end, end: b.end, label: `${a.text} ${b.text}`, capitalizeNext: false })
  }
  return cuts
}

const fillerCuts = (text: string, locked: readonly Span[]): Cut[] => {
  const found = [...text.matchAll(FILLER), ...text.matchAll(FILLER_ER)]
  const cuts: Cut[] = []
  for (const m of found) {
    const first = m.index ?? 0
    const word: Span = { start: first, end: first + m[0].length }
    if (overlaps(word, locked)) continue

    let start = word.start
    let end = word.end
    if (text[end] === ',') end += 1
    if (isBlank(text[end])) {
      while (isBlank(text[end])) end += 1
    } else {
      while (start > 0 && isBlank(text[start - 1])) start -= 1
    }

    const before = text.slice(0, word.start).trimEnd()
    const isSentenceStart = before === '' || /[.!?]$/.test(before) || /\n\s*$/.test(text.slice(0, word.start))
    const isUpper = m[0].charAt(0) !== m[0].charAt(0).toLowerCase()
    cuts.push({ start, end, label: m[0], capitalizeNext: isUpper && isSentenceStart })
  }
  return cuts
}

export const cleanup = (text: string): Cleaned => {
  const locked = protectedSpans(text)
  const cuts = [...stutterCuts(text, locked), ...fillerCuts(text, locked)].sort((a, b) => a.start - b.start)
  if (cuts.length === 0) return { text, removed: [] }

  let out = ''
  let pos = 0
  let capitalize = false
  for (const cut of cuts) {
    if (cut.start < pos) {
      pos = Math.max(pos, cut.end)
      continue
    }
    const kept = text.slice(pos, cut.start)
    out += capitalize ? kept.charAt(0).toUpperCase() + kept.slice(1) : kept
    capitalize = capitalize && kept === '' ? true : cut.capitalizeNext
    pos = cut.end
  }
  const tail = text.slice(pos)
  out += capitalize ? tail.charAt(0).toUpperCase() + tail.slice(1) : tail

  if (out.trim() === '') return { text, removed: [] }
  return { text: out, removed: [...new Set(cuts.map(c => c.label))] }
}
