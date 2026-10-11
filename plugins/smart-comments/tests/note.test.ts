import { expect, test } from 'claude-code/testing'

import { judgeFile } from '../src/judge'
import { editNote, flaggedIn, turnPrompt } from '../src/note'

const CODE = [
  '// check the cache',
  'const hit = cache.get(id)',
  '// 40 ms p99 on the 2024 box',
  'const LIMIT = 64',
  '// Now uses a Map',
  'const m = new Map()',
  '/** Loads a user. */',
  'export function loadUser() {}',
].join('\n')

const judged = judgeFile('src/a.ts', CODE, true)

test('the note names each line to delete and why, and the lines to leave', () => {
  expect(editNote({ path: 'src/a.ts', judged, max: 3, crowd: null, allowDocs: true })).toBe(
    [
      'smart-comments: 3 new comment lines in src/a.ts.',
      'Delete these 2, or rewrite them to say what the code cannot:',
      '  L1    repeats the code      // check the cache',
      '  L5    tells the edit story  // Now uses a Map',
      'Leave L3 as it is: it records what the code cannot say.',
      'A comment earns its place when it tells the reader what the code cannot: a measured figure, a pitfall, or a rule that must hold. Docstrings are fine.',
    ].join('\n'),
  )
})

const PLAIN = ['// Tail of path a', 'a()', '// Tail of path b', 'b()'].join('\n')

test('no note when nothing trips', () => {
  const clean = judgeFile('a.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64\n// Tail of the happy path\nreturn user', true)
  expect(editNote({ path: 'a.ts', judged: clean, max: 3, crowd: null, allowDocs: true })).toBe(null)
  expect(turnPrompt([{ path: 'a.ts', judged: clean, max: 3 }], true)).toBe(null)
})

test('one line to delete is offered a rewrite too', () => {
  const one = judgeFile('a.ts', '// check the cache\nconst hit = cache.get(id)', true)
  expect(editNote({ path: 'a.ts', judged: one, max: 3, crowd: null, allowDocs: true })).toContain('Delete this one, or rewrite it to say what the code cannot:')
})

test('the count of flagged lines is the noise, plus the plain lines when they are over or crowded', () => {
  expect(flaggedIn(judged, 3, null)).toBe(2)
  const plain = judgeFile('a.ts', PLAIN, true)
  expect(flaggedIn(plain, 3, null)).toBe(0)
  expect(flaggedIn(plain, 1, null)).toBe(2)
  expect(flaggedIn(plain, 3, { from: 1, to: 12, comments: 6, lines: 12 })).toBe(2)
})

test('plain lines past the limit are listed, with how many may stay', () => {
  const note = editNote({ path: 'a.ts', judged: judgeFile('a.ts', PLAIN, true), max: 1, crowd: null, allowDocs: false })
  expect(note).toBe(
    [
      'smart-comments: 2 new comment lines in a.ts.',
      '2 lines add little, and the limit is 1. Keep the one a reader needs most:',
      '  L1    // Tail of path a',
      '  L3    // Tail of path b',
      'A comment earns its place when it tells the reader what the code cannot: a measured figure, a pitfall, or a rule that must hold.',
    ].join('\n'),
  )
})

test('a crowded stretch is named when the edit put a plain comment in it', () => {
  const note = editNote({ path: 'a.ts', judged: judgeFile('a.ts', PLAIN, true), max: 3, crowd: { from: 1, to: 12, comments: 6, lines: 12 }, allowDocs: true })
  expect(note).toContain('Lines 1 to 12 are crowded: 6 of 12 lines are comments that add little. Add no more there:')
  expect(note).toContain('  L1    // Tail of path a')
  const kept = judgeFile('a.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64', true)
  expect(editNote({ path: 'a.ts', judged: kept, max: 3, crowd: { from: 1, to: 12, comments: 6, lines: 12 }, allowDocs: true })).toBe(null)
})

test('the turn prompt lists every file that still trips, and asks for those lines only', () => {
  const clean = judgeFile('b.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64', true)
  const prompt = turnPrompt([{ path: 'src/a.ts', judged, max: 3 }, { path: 'b.ts', judged: clean, max: 3 }], true)
  expect(prompt).toContain('smart-comments: comments you added this turn need one more pass.')
  expect(prompt).toContain('3 new comment lines in src/a.ts.')
  expect(prompt).toContain('  L1    repeats the code      // check the cache')
  expect(prompt).not.toContain('b.ts')
  expect(prompt).toContain('Change these lines and nothing else.')
})

test('each file of the turn prompt has its own limit', () => {
  const plain = judgeFile('a.ts', PLAIN, true)
  expect(turnPrompt([{ path: 'a.ts', judged: plain, max: 2 }], true)).toBe(null)
  expect(turnPrompt([{ path: 'a.ts', judged: plain, max: 1 }], true)).toContain('the limit is 1')
})
