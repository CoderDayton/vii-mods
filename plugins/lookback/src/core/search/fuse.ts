import type { Ranked } from '../types'
import { DEFAULT_TUNING } from './tuning'
import type { Tuning } from './tuning'

// The two rankings of one question: by words (BM25, 0 and up) and by meaning (cosine similarity).
export type Lists = { words: readonly Ranked[]; meaning: readonly Ranked[] }

// The lowest score the word ranking can hand over. A score is scaled between its floor and the best of its
// list, not between the worst and the best: a list of near-equal scores then stays near-equal, where a scale
// taken from the list itself would spread it from 0 to 1.
export const WORDS_FLOOR = 0

// How far the best of a list is above the last one asked for, as a share of its distance from the floor: 0 for
// a list of equal scores, near 1 for one clear leader. A list that came back short matched little, which is
// a clear answer too.
export const standingOut = (list: readonly Ranked[], floor: number, asked: number): number => {
  const top = list[0]?.score
  if (top === undefined) return 0
  const last = list[asked - 1]?.score
  if (last === undefined || top <= floor) return 1
  return Math.min(1, Math.max(0, (top - last) / (top - floor)))
}

// The share of the fused score that meaning gets for this question, from 0 (words alone) to 1. It moves from
// the usual share toward the list whose best entries stand out more.
export const balanceOf = (lists: Lists, asked: number, tuning: Tuning = DEFAULT_TUNING): number => {
  if (lists.meaning.length === 0) return 0
  if (lists.words.length === 0) return 1
  const meaning = tuning.balance * standingOut(lists.meaning, tuning.meaningFloor, asked)
  const words = (1 - tuning.balance) * standingOut(lists.words, WORDS_FLOOR, asked)
  const balance = meaning + words === 0 ? tuning.balance : meaning / (meaning + words)
  return Math.min(tuning.maxBalance, Math.max(tuning.minBalance, balance))
}

// A list whose best is at or under the floor scores 0 throughout.
const scaled = (list: readonly Ranked[], floor: number): Map<number, number> => {
  const span = (list[0]?.score ?? floor) - floor
  return new Map(list.map(item => [item.id, span <= 0 ? 0 : Math.max(0, (item.score - floor) / span)]))
}

// An entry that one list lacks scores 0 there, so the fused scores run from 0 to 1.
export const fuse = (lists: Lists, balance: number, tuning: Tuning = DEFAULT_TUNING): Ranked[] => {
  const words = scaled(lists.words, WORDS_FLOOR)
  const meaning = scaled(lists.meaning, tuning.meaningFloor)
  return [...new Set([...words.keys(), ...meaning.keys()])]
    .map(id => ({ id, score: (1 - balance) * (words.get(id) ?? 0) + balance * (meaning.get(id) ?? 0) }))
    .sort((a, b) => b.score - a.score)
}
