import { expect, test } from 'claude-code/testing'

import { addedCode, changedRange, crowdAround, freshLines } from '../src/diff'
import { judgeFile } from '../src/judge'
import { syntaxOf } from '../src/syntax'
import type { Syntax } from '../src/syntax'

const TS = syntaxOf('a.ts') as Syntax

test('a comment that the old text did not have is new', () => {
  const before = '// keep me\nconst a = 1\n'
  const after = '// keep me\nconst a = 1\n// brand new\nconst b = 2 // also new\n'
  expect([...freshLines(before, after, TS)]).toEqual([3, 4])
})

test('every comment of a new file is new', () => {
  expect([...freshLines(null, '// one\nrun()\n// two\n', TS)]).toEqual([1, 3])
})

test('a comment that only moved is not new, and a second copy of one is', () => {
  expect([...freshLines('// note\nconst a = 1\n', 'const a = 1\n// note\n', TS)]).toEqual([])
  expect([...freshLines('// note\nconst a = 1\n', '// note\nconst a = 1\n// note\n', TS)]).toEqual([3])
})

test('added code is the lines the old text did not have, without blank and comment lines', () => {
  const before = 'const a = 1\n// note\n'
  const after = 'const a = 1\n// note\n\n// more\nconst b = 2\nconst c = 3 // why\n/*\n * block\n */\n'
  expect(addedCode(before, after, TS)).toBe(2)
  expect(addedCode(null, after, TS)).toBe(3)
  expect(addedCode(after, after, TS)).toBe(0)
})

test('the changed range is the lines of the new text between the shared head and tail', () => {
  expect(changedRange('a\nb\nc\nd', 'a\nX\nY\nc\nd')).toEqual({ from: 2, to: 3 })
  expect(changedRange('a\nb\nc', 'a\nc')).toEqual({ from: 2, to: 2 })
  expect(changedRange(null, 'a\nb\nc')).toEqual({ from: 1, to: 3 })
})

const crowded = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? `// Tail of path ${'abcdefghijkl'[i]}` : `step${i}()`)).join('\n')

test('a stretch where more than four lines in ten are comments that add little is crowded', () => {
  const judged = judgeFile('a.ts', crowded, true)
  expect(crowdAround(crowded, judged, { from: 5, to: 5 })).toEqual({ from: 1, to: 12, comments: 6, lines: 12 })
})

test('kept comments, docstrings and short stretches do not crowd', () => {
  const kept = crowded.replaceAll('Tail of path', 'Must hold the lock:')
  expect(crowdAround(kept, judgeFile('a.ts', kept, true), { from: 5, to: 5 })).toBe(null)
  const short = '// Tail of path a\nrun()\n// Tail of path b\nstop()'
  expect(crowdAround(short, judgeFile('a.ts', short, true), { from: 1, to: 1 })).toBe(null)
})
