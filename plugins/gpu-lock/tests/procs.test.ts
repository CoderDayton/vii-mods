import { expect, test } from 'claude-code/testing'

import { jobOf, parseParents, PS_ARGV } from '../src/procs'

test('reads pid and parent pid pairs, skipping lines that are not a pair', () => {
  const parents = parseParents('    1     0\n   20     1\n  300    20\nbad line\n  x 5\n')
  expect([...parents]).toEqual([
    [1, 0],
    [20, 1],
    [300, 20],
  ])
})

test('a process belongs to the job above it in the tree', () => {
  const parents = parseParents('1 0\n20 1\n300 20\n4000 300\n55 1\n')
  const jobs = new Set([20])
  expect(jobOf(4000, jobs, parents)).toBe(20)
  expect(jobOf(300, jobs, parents)).toBe(20)
  expect(jobOf(20, jobs, parents)).toBe(20)
  expect(jobOf(55, jobs, parents)).toBe(null)
  expect(jobOf(999, jobs, parents)).toBe(null)
})

test('a loop in the tree ends the walk', () => {
  const parents = parseParents('7 8\n8 7\n')
  expect(jobOf(7, new Set([99]), parents)).toBe(null)
})

test('the nearest job wins when jobs nest', () => {
  const parents = parseParents('10 1\n20 10\n30 20\n')
  expect(jobOf(30, new Set([10, 20]), parents)).toBe(20)
})

test('the process list is one plain ps call', () => {
  expect(PS_ARGV).toEqual(['ps', '-e', '-o', 'pid=,ppid='])
})
