import { expect, test } from 'claude-code/testing'

import { balanceOf, fuse, standingOut } from '../src/core/search/fuse'

const ids = (list: { id: number }[]): number[] => list.map(r => r.id)

const flat = (from: number, to: number, n: number, firstId = 1) => Array.from({ length: n }, (_, i) => ({ id: firstId + i, score: from - ((from - to) * i) / (n - 1) }))

test('an entry found by both lists beats one that leads only one list', () => {
  const words = [{ id: 1, score: 9 }, { id: 2, score: 8 }]
  const meaning = [{ id: 3, score: 0.9 }, { id: 2, score: 0.85 }]
  expect(ids(fuse({ words, meaning }, 0.5))[0]).toBe(2)
})

test('a strong match in one list beats a weak match in both', () => {
  const words = [{ id: 1, score: 20 }, { id: 2, score: 4 }]
  const meaning = [{ id: 3, score: 0.9 }, { id: 2, score: 0.45 }]
  expect(ids(fuse({ words, meaning }, 0.5)).at(-1)).toBe(2)
})

test('the balance says how much the meaning list counts', () => {
  const words = [{ id: 1, score: 5 }]
  const meaning = [{ id: 2, score: 0.8 }]
  expect(ids(fuse({ words, meaning }, 0.9))[0]).toBe(2)
  expect(ids(fuse({ words, meaning }, 0.1))[0]).toBe(1)
})

test('fused scores run from 0 to 1, and no entries give nothing', () => {
  const fused = fuse({ words: [{ id: 1, score: 7 }], meaning: [{ id: 1, score: 0.7 }] }, 0.5)
  expect(fused).toEqual([{ id: 1, score: 1 }])
  expect(fuse({ words: [], meaning: [] }, 0.5)).toEqual([])
})

test('a list stands out when its best is far above the last one asked for', () => {
  expect(standingOut(flat(7, 6.9, 60), 0, 60)).toBeLessThan(0.05)
  expect(standingOut(flat(24, 8, 60), 0, 60)).toBeGreaterThan(0.6)
  expect(standingOut(flat(0.74, 0.72, 60), 0.4, 60)).toBeLessThan(0.1)
})

test('a list shorter than asked for stands out in full, and an empty one not at all', () => {
  expect(standingOut(flat(7, 6.9, 5), 0, 60)).toBe(1)
  expect(standingOut([], 0, 60)).toBe(0)
})

test('words that match everything alike lean the balance on meaning', () => {
  const lists = { words: flat(7, 6.9, 60), meaning: flat(0.8, 0.55, 60, 100) }
  expect(balanceOf(lists, 60)).toBeGreaterThan(0.7)
})

test('words with a clear leader, and meanings all alike, lean the balance on words', () => {
  const lists = { words: flat(24, 8, 60), meaning: flat(0.62, 0.6, 60, 100) }
  expect(balanceOf(lists, 60)).toBeLessThan(0.3)
})

test('two lists that stand out alike share the score evenly', () => {
  const lists = { words: flat(20, 10, 60), meaning: flat(0.9, 0.7, 60, 100) }
  expect(Math.abs(balanceOf(lists, 60) - 0.5)).toBeLessThan(1e-9)
})

test('neither list is silenced while both hold entries, and a missing list leaves the other alone', () => {
  const peaked = flat(24, 1, 60)
  const level = [{ id: 900, score: 0.7 }, ...flat(0.7, 0.7, 59, 100)]
  expect(balanceOf({ words: peaked, meaning: level }, 60)).toBe(0.15)
  expect(balanceOf({ words: peaked, meaning: [] }, 60)).toBe(0)
  expect(balanceOf({ words: [], meaning: level }, 60)).toBe(1)
})

test('a meaning list that is wholly under the floor gives nothing', () => {
  const words = [{ id: 1, score: 9 }, { id: 2, score: 3 }]
  const meaning = [{ id: 3, score: 0.45 }, { id: 4, score: 0.42 }]
  const fused = fuse({ words, meaning }, 0.5)
  expect(fused.find(r => r.id === 3)?.score).toBe(0)
  expect(ids(fused).slice(0, 2)).toEqual([1, 2])
})
