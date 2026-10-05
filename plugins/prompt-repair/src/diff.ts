import type { Pair } from './types'
import { at, tokenize } from './text'
import type { Token } from './text'

type Run = { aFrom: number; aTo: number; bFrom: number; bTo: number }

type Alignment = { a: Token[]; b: Token[]; runs: Run[] }

const align = (before: string, after: string): Alignment => {
  const a = tokenize(before)
  const b = tokenize(after)
  const same = (i: number, j: number): boolean => i < a.length && j < b.length && at(a, i).text === at(b, j).text

  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const cell = (i: number, j: number): number => at(at(lcs, i), j)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      at(lcs, i)[j] = same(i, j) ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }

  const runs: Run[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (same(i, j)) {
      i += 1
      j += 1
      continue
    }
    const aFrom = i
    const bFrom = j
    while (i < a.length || j < b.length) {
      if (same(i, j)) break
      if (j >= b.length || (i < a.length && cell(i + 1, j) >= cell(i, j + 1))) i += 1
      else j += 1
    }
    runs.push({ aFrom, aTo: i, bFrom, bTo: j })
  }
  return { a, b, runs }
}

const slice = (src: string, toks: readonly Token[], from: number, to: number): string =>
  from === to ? '' : src.slice(at(toks, from).start, at(toks, to - 1).end)

export const diffPairs = (before: string, after: string): Pair[] => {
  const { a, b, runs } = align(before, after)
  return runs.map(r => ({ heard: slice(before, a, r.aFrom, r.aTo), meant: slice(after, b, r.bFrom, r.bTo) }))
}

export type Seg = { text: string; isChanged: boolean }

const CONTEXT_BEFORE = 24
const ELLIPSIS = '…'

const segments = (src: string, toks: readonly Token[], spans: readonly [number, number][]): Seg[] => {
  const out: Seg[] = []
  const push = (text: string, isChanged: boolean) => {
    if (text !== '') out.push({ text, isChanged })
  }
  let pos = 0
  for (const [from, to] of spans) {
    const start = at(toks, from).start
    const end = at(toks, to - 1).end
    push(src.slice(pos, start), false)
    push(src.slice(start, end), true)
    pos = end
  }
  push(src.slice(pos), false)
  return out
}

export const markChanges = (before: string, after: string): { before: Seg[]; after: Seg[] } => {
  const { a, b, runs } = align(before, after)
  const aSpans = runs.filter(r => r.aFrom < r.aTo).map((r): [number, number] => [r.aFrom, r.aTo])
  const bSpans = runs.filter(r => r.bFrom < r.bTo).map((r): [number, number] => [r.bFrom, r.bTo])
  return { before: segments(before, a, aSpans), after: segments(after, b, bSpans) }
}

export const windowSegments = (segs: readonly Seg[], max: number): Seg[] => {
  const total = segs.reduce((n, s) => n + s.text.length, 0)
  if (total <= max) return [...segs]

  let firstAt = 0
  let pos = 0
  for (const s of segs) {
    if (s.isChanged) {
      firstAt = pos
      break
    }
    pos += s.text.length
  }
  const end = Math.min(total, Math.max(0, firstAt - CONTEXT_BEFORE) + max)
  const start = Math.max(0, end - max)

  const out: Seg[] = start > 0 ? [{ text: ELLIPSIS, isChanged: false }] : []
  pos = 0
  for (const s of segs) {
    const from = Math.max(start, pos)
    const to = Math.min(end, pos + s.text.length)
    if (from < to) out.push({ text: s.text.slice(from - pos, to - pos), isChanged: s.isChanged })
    pos += s.text.length
  }
  if (end < total) out.push({ text: ELLIPSIS, isChanged: false })
  return out
}
