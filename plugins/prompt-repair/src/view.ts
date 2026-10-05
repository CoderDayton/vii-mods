import type { Pair, Review } from '../types'
import { markChanges, windowSegments } from './diff'
import type { Seg } from './diff'

export type ReviewModel = {
  count: string
  summary: string
  before: Seg[]
  after: Seg[]
}

const MAX_SHOWN = 3
const LABEL_WIDTH = 6
const BOX_CHROME = 4
const MIN_TEXT = 24
const RETURN_MARK = ' ↵ '

export const describePairs = (list: readonly Pair[]): string => {
  const shown = list
    .slice(0, MAX_SHOWN)
    .map(p => `${p.heard === '' ? '(added)' : p.heard} → ${p.meant === '' ? '(removed)' : p.meant}`)
  const more = list.length - shown.length
  return more > 0 ? `${shown.join(', ')} +${more} more` : shown.join(', ')
}

const flatten = (segs: readonly Seg[]): Seg[] =>
  segs.map(s => ({ text: s.text.replace(/\s*\n\s*/g, RETURN_MARK), isChanged: s.isChanged }))

export const reviewModel = (review: Review, columns: number): ReviewModel => {
  const width = Math.max(MIN_TEXT, columns - BOX_CHROME - LABEL_WIDTH)
  const marked = markChanges(review.original.trim(), review.fixed.trim())
  const n = Math.max(1, review.pairs.length)
  return {
    count: `${n} ${n === 1 ? 'change' : 'changes'}`,
    summary: describePairs(review.pairs),
    before: windowSegments(flatten(marked.before), width),
    after: windowSegments(flatten(marked.after), width),
  }
}
