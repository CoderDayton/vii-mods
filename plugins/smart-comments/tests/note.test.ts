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
      'smart-comments: 3 new comment lines in src/a.ts; L3 is fine.',
      'Delete or rewrite L1 (repeats the code), L5 (tells the edit story).',
      'A comment should say what the code cannot: a figure, a pitfall or a rule. Docstrings are fine.',
    ].join('\n'),
  )
})

const PLAIN = ['// Tail of path a', 'a()', '// Tail of path b', 'b()'].join('\n')

test('no note when nothing trips', () => {
  const clean = judgeFile('a.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64\n// Tail of the happy path\nreturn user', true)
  expect(editNote({ path: 'a.ts', judged: clean, max: 3, crowd: null, allowDocs: true })).toBe(null)
  expect(turnPrompt([{ path: 'a.ts', judged: clean, max: 3 }], true)).toBe(null)
})

test('lines with one fault are named together, and lines in a row as a range', () => {
  const code = ['// check the cache', '// get the cache', 'const hit = cache.get(id)', '// 40 ms p99 on the 2024 box', '// 64 is the page size of the store', '// The store rejects more than 64 at once', 'const LIMIT = 64'].join('\n')
  const note = editNote({ path: 'a.ts', judged: judgeFile('a.ts', code, true), max: 3, crowd: null, allowDocs: true })
  expect(note).toContain('Delete or rewrite L1-2 (repeats the code).')
  expect(note?.split('\n')).toHaveLength(3)
})

test('a long list of comments still gives a note of three lines', () => {
  const code = Array.from({ length: 12 }, (_, i) => `// Tail of path ${String.fromCharCode(97 + i)}\nstep${i}()`).join('\n')
  const note = editNote({ path: 'a.ts', judged: judgeFile('a.ts', code, true), max: 3, crowd: null, allowDocs: true })
  expect(note?.split('\n')).toHaveLength(3)
  expect(note).toContain('12 lines add little, and the limit is 3: keep 3 of L1, L3, L5, L7, L9, L11, L13, L15, L17, L19, L21, L23.')
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
      '2 lines add little, and the limit is 1: keep one of L1, L3.',
      'A comment should say what the code cannot: a figure, a pitfall or a rule.',
    ].join('\n'),
  )
})

test('a crowded stretch is named when the edit put a plain comment in it', () => {
  const note = editNote({ path: 'a.ts', judged: judgeFile('a.ts', PLAIN, true), max: 3, crowd: { from: 1, to: 12, comments: 6, lines: 12 }, allowDocs: true })
  expect(note).toContain('L1-12 is crowded, 6 of 12 lines are comments that add little: add no more like L1, L3.')
  const kept = judgeFile('a.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64', true)
  expect(editNote({ path: 'a.ts', judged: kept, max: 3, crowd: { from: 1, to: 12, comments: 6, lines: 12 }, allowDocs: true })).toBe(null)
})

test('with comments off the note says to delete the lines and to write none', () => {
  const code = '// 40 ms p99 on the 2024 box\nconst LIMIT = 64\n// Tail of the happy path\nreturn user\n// eslint-disable-next-line no-console\nconsole.log(1)'
  const off = judgeFile('a.ts', code, true, true)
  expect(editNote({ path: 'a.ts', judged: off, max: 3, crowd: null, allowDocs: true, noComments: true })).toBe(
    ['smart-comments: 3 new comment lines in a.ts; L5 is fine.', 'Delete L1, L3.', 'Comments are off: write none.'].join('\n'),
  )
  const prompt = turnPrompt([{ path: 'a.ts', judged: off, max: 3 }], true, true)
  expect(prompt?.split('\n')).toEqual([
    'smart-comments: comments you added this turn need one more pass.',
    'smart-comments: 3 new comment lines in a.ts; L5 is fine.',
    'Delete L1, L3.',
    'Comments are off: write none. Change these lines and nothing else.',
  ])
  const directive = judgeFile('a.ts', '// eslint-disable-next-line no-console\nconsole.log(1)', true, true)
  expect(editNote({ path: 'a.ts', judged: directive, max: 3, crowd: null, allowDocs: true, noComments: true })).toBe(null)
})

test('the turn prompt lists every file that still trips, and asks for those lines only', () => {
  const clean = judgeFile('b.ts', '// 40 ms p99 on the 2024 box\nconst LIMIT = 64', true)
  const prompt = turnPrompt([{ path: 'src/a.ts', judged, max: 3 }, { path: 'b.ts', judged: clean, max: 3 }], true)
  expect(prompt).toContain('smart-comments: comments you added this turn need one more pass.')
  expect(prompt).toContain('3 new comment lines in src/a.ts; L3 is fine.')
  expect(prompt).toContain('L1 (repeats the code)')
  expect(prompt).not.toContain('b.ts')
  expect(prompt?.split('\n').at(-1)).toBe('A comment should say what the code cannot: a figure, a pitfall or a rule. Docstrings are fine. Change these lines and nothing else.')
})

test('each file of the turn prompt has its own limit', () => {
  const plain = judgeFile('a.ts', PLAIN, true)
  expect(turnPrompt([{ path: 'a.ts', judged: plain, max: 2 }], true)).toBe(null)
  expect(turnPrompt([{ path: 'a.ts', judged: plain, max: 1 }], true)).toContain('the limit is 1')
})
