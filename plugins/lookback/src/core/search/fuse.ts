import type { Ranked } from '../types'

export type FuseOptions = {
  // The rank constant of reciprocal rank fusion. A larger value flattens the gap between the top ranks.
  k?: number
  // How much each list counts, in the order of the lists. One for each by default.
  weights?: readonly number[]
}

// Merges ranked lists into one by reciprocal rank fusion: an entry scores the sum of 1 / (k + rank) over the
// lists that hold it. Only ranks count, so lists scored on different scales (BM25 and cosine similarity) mix
// without calibration. Equal scores keep the order in which the entries first appeared.
export const fuse = (lists: readonly (readonly Ranked[])[], options: FuseOptions = {}): Ranked[] => {
  const k = options.k ?? 60
  const scores = new Map<number, number>()
  lists.forEach((list, which) => {
    const weight = options.weights?.[which] ?? 1
    list.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (k + rank + 1))
    })
  })
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}
