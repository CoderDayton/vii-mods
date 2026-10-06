import type { Review } from '../types'
import { markChanges } from './diff'
import type { Seg } from './diff'

export type Row = { kind: 'ctx' | 'del' | 'ins' | 'fold'; segs: Seg[]; skipped?: number }

export type ReviewModel = {
  count: string
  size: string
  rows: Row[]
}

type Op = { type: 'eq'; lines: string[] } | { type: 'chg'; old: string[]; new: string[] }

// Unchanged lines kept next to a change; a longer run folds to one row.
const CONTEXT = 1

const lineOps = (a: readonly string[], b: readonly string[]): Op[] => {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const cell = (i: number, j: number): number => lcs[i]?.[j] ?? 0
  const same = (i: number, j: number): boolean => i < a.length && j < b.length && a[i] === b[j]
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i]
      if (row !== undefined) row[j] = same(i, j) ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (same(i, j)) {
      const last = ops.at(-1)
      if (last?.type === 'eq') last.lines.push(a[i] ?? '')
      else ops.push({ type: 'eq', lines: [a[i] ?? ''] })
      i += 1
      j += 1
      continue
    }
    const old: string[] = []
    const added: string[] = []
    while ((i < a.length || j < b.length) && !same(i, j)) {
      if (j >= b.length || (i < a.length && cell(i + 1, j) >= cell(i, j + 1))) old.push(a[i++] ?? '')
      else added.push(b[j++] ?? '')
    }
    ops.push({ type: 'chg', old, new: added })
  }
  return ops
}

// Cuts marked segments at their line breaks, one list of segments per line.
const splitLines = (segs: readonly Seg[]): Seg[][] => {
  const lines: Seg[][] = [[]]
  for (const seg of segs) {
    const parts = seg.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part !== '') lines.at(-1)?.push({ text: part, isChanged: seg.isChanged })
    })
  }
  return lines
}

const plain = (line: string): Seg[] => (line === '' ? [] : [{ text: line, isChanged: false }])

const hunkRows = (old: readonly string[], added: readonly string[]): Row[] => {
  if (old.length === 0) return added.map(line => ({ kind: 'ins', segs: plain(line) }))
  if (added.length === 0) return old.map(line => ({ kind: 'del', segs: plain(line) }))
  const marked = markChanges(old.join('\n'), added.join('\n'))
  return [
    ...splitLines(marked.before).map((segs): Row => ({ kind: 'del', segs })),
    ...splitLines(marked.after).map((segs): Row => ({ kind: 'ins', segs })),
  ]
}

const contextRows = (lines: readonly string[], hasPrev: boolean, hasNext: boolean): Row[] => {
  const head = hasPrev ? CONTEXT : 0
  const tail = hasNext ? CONTEXT : 0
  const hidden = lines.length - head - tail
  const ctx = (list: readonly string[]): Row[] => list.map(line => ({ kind: 'ctx', segs: plain(line) }))
  if (hidden <= 1) return ctx(lines)
  return [
    ...ctx(lines.slice(0, head)),
    { kind: 'fold', segs: [], skipped: hidden },
    ...ctx(lines.slice(lines.length - tail)),
  ]
}

export const reviewModel = (review: Review): ReviewModel => {
  const original = review.original.trim()
  const fixed = review.fixed.trim()
  const n = review.pairs.length
  const ops = lineOps(original.split('\n'), fixed.split('\n'))

  const rows = ops.some(op => op.type === 'chg')
    ? ops.flatMap((op, index): Row[] =>
        op.type === 'eq' ? contextRows(op.lines, index > 0, index < ops.length - 1) : hunkRows(op.old, op.new),
      )
    : []

  return {
    count: n === 0 ? 'no word changes' : `${n} ${n === 1 ? 'change' : 'changes'}`,
    size: `${original.length} → ${fixed.length} chars`,
    rows,
  }
}
