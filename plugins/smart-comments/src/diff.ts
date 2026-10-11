import type { Judged } from './judge'
import { commentsOf } from './syntax'
import type { Syntax } from './syntax'

// The lines of `after` whose comment `before` did not have. A comment that only moved is not new; a
// second copy of one is. `before` is null for a file that did not exist.
export const freshLines = (before: string | null, after: string, syn: Syntax): Set<number> => {
  const had = new Map<string, number>()
  if (before !== null) for (const c of commentsOf(before, syn).list) had.set(c.raw, (had.get(c.raw) ?? 0) + 1)
  const fresh = new Set<number>()
  for (const c of commentsOf(after, syn).list) {
    const left = had.get(c.raw) ?? 0
    if (left > 0) had.set(c.raw, left - 1)
    else fresh.add(c.line)
  }
  return fresh
}

const codeOf = (text: string, syn: Syntax): string[] => {
  const { lines } = commentsOf(text, syn)
  return text
    .split('\n')
    .filter((l, i) => l.trim() !== '' && !lines.has(i + 1))
    .map(l => l.trim())
}

// How many lines of code `after` has that `before` did not: blank lines and lines that are all
// comment are not counted.
export const addedCode = (before: string | null, after: string, syn: Syntax): number => {
  const had = new Map<string, number>()
  if (before !== null) for (const l of codeOf(before, syn)) had.set(l, (had.get(l) ?? 0) + 1)
  let added = 0
  for (const l of codeOf(after, syn)) {
    const left = had.get(l) ?? 0
    if (left > 0) had.set(l, left - 1)
    else added++
  }
  return added
}

export type Range = { from: number; to: number }

// The lines of `after`, 1-based, between the head and the tail it shares with `before`. Where lines
// were only taken out, the one line at the cut.
export const changedRange = (before: string | null, after: string): Range => {
  const b = after.split('\n')
  if (before === null) return { from: 1, to: b.length }
  const a = before.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const from = Math.min(head + 1, b.length)
  return { from, to: Math.max(from, b.length - tail) }
}

export type Crowd = Range & { comments: number; lines: number }

// Lines looked at on each side of an edit.
const REACH = 10
const MIN_LINES = 8
const MAX_SHARE = 0.4

// The stretch around an edit, when more than four in ten of its lines are comments that add little.
export const crowdAround = (text: string, judged: readonly Judged[], changed: Range): Crowd | null => {
  const all = text.split('\n')
  const from = Math.max(1, changed.from - REACH)
  const to = Math.min(all.length, changed.to + REACH)
  const lines = all.slice(from - 1, to).filter(l => l.trim() !== '').length
  const comments = judged.filter(j => j.line >= from && j.line <= to && (j.kind === 'plain' || j.kind === 'noise')).length
  return lines >= MIN_LINES && comments / lines > MAX_SHARE ? { from, to, comments, lines } : null
}
