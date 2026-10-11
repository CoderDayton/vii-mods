import { expect, test } from 'claude-code/testing'

import { fuse } from '../src/core/search/fuse'

const ids = (list: { id: number }[]): number[] => list.map(r => r.id)

test('an entry found by both lists beats one that only leads one list', () => {
  const keyword = [{ id: 1, score: 9 }, { id: 2, score: 5 }]
  const meaning = [{ id: 3, score: 0.9 }, { id: 2, score: 0.8 }]
  expect(ids(fuse([keyword, meaning]))[0]).toBe(2)
})

test('the raw scores do not matter, only the ranks', () => {
  const a = fuse([[{ id: 1, score: 1000 }, { id: 2, score: 1 }], [{ id: 2, score: 0.2 }, { id: 1, score: 0.1 }]])
  const b = fuse([[{ id: 1, score: 2 }, { id: 2, score: 1 }], [{ id: 2, score: 9 }, { id: 1, score: 8 }]])
  expect(ids(a)).toEqual(ids(b))
})

test('a weight makes one list count for more', () => {
  const keyword = [{ id: 1, score: 1 }]
  const meaning = [{ id: 2, score: 1 }]
  expect(ids(fuse([keyword, meaning], { weights: [1, 3] }))[0]).toBe(2)
  expect(ids(fuse([keyword, meaning], { weights: [3, 1] }))[0]).toBe(1)
})

test('equal fused scores keep the order of the first list, and no lists give nothing', () => {
  expect(ids(fuse([[{ id: 5, score: 1 }], [{ id: 6, score: 1 }]]))).toEqual([5, 6])
  expect(fuse([])).toEqual([])
  expect(fuse([[], []])).toEqual([])
})
