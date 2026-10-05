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

export const keepsLayout = (before: string, after: string): boolean => {
  const { a, b, runs } = align(before, after)
  let aPos = 0
  let bPos = 0
  for (const r of runs) {
    if (r.aFrom === r.aTo || r.bFrom === r.bTo) return false
    const aStart = at(a, r.aFrom).start
    const bStart = at(b, r.bFrom).start
    if (before.slice(aPos, aStart) !== after.slice(bPos, bStart)) return false
    aPos = at(a, r.aTo - 1).end
    bPos = at(b, r.bTo - 1).end
  }
  return before.slice(aPos) === after.slice(bPos)
}
