import { expect, test } from 'claude-code/testing'

import { fires, groundedTrigger, parseTrigger, showTrigger, tokensOf, useLine } from '../src/trigger'
import type { Use } from '../src/trigger'

const COMMIT: Use = { tool: 'Bash', input: { command: 'git commit -m "Fix the Maze"', description: 'Commit' } }
const EDIT: Use = { tool: 'Edit', input: { file_path: '/work/src/maze.ts', old_string: 'a', new_string: 'b' } }

test('the tokens of a call are the whole words of every string in it, lower case', () => {
  expect([...tokensOf(COMMIT.input)]).toEqual(['git', 'commit', 'm', 'fix', 'the', 'maze'])
  expect(tokensOf({ a: ['x.ts', { b: 'Y-z' }], n: 4, c: null }).has('x.ts')).toBe(true)
  expect(tokensOf({ a: ['x.ts', { b: 'Y-z' }] }).has('y-z')).toBe(true)
})

test('a trigger fires on its tool when the call has every word, as whole words', () => {
  const t = { tool: 'Bash', words: ['git', 'commit'] }
  expect(fires(t, 'Bash', tokensOf({ command: 'cd /x && git   commit --amend' }))).toBe(true)
  expect(fires(t, 'Bash', tokensOf({ command: 'git log --grep=committed' }))).toBe(false)
  expect(fires(t, 'Bash', tokensOf({ command: 'git status' }))).toBe(false)
  expect(fires(t, 'Edit', tokensOf({ file_path: 'git commit' }))).toBe(false)
})

test('a trigger from the model is taken when a call Claude just made fires it', () => {
  expect(groundedTrigger({ tool: 'Bash', words: ['Git', 'commit', 'git'] }, [EDIT, COMMIT])).toEqual({ tool: 'Bash', words: ['git', 'commit'] })
})

test('a trigger that no recent call fires is dropped', () => {
  expect(groundedTrigger({ tool: 'Bash', words: ['git', 'push'] }, [EDIT, COMMIT])).toBe(null)
  expect(groundedTrigger({ tool: 'Write', words: ['maze.ts'] }, [EDIT, COMMIT])).toBe(null)
  expect(groundedTrigger({ tool: 'Bash', words: ['git', 'commit'] }, [])).toBe(null)
})

test('a trigger with no words, too many words, or a word that is not one word is dropped', () => {
  for (const words of [[], ['git', 'commit', 'm', 'fix', 'the'], ['git commit'], ['.*'], [4], 'git']) {
    expect(groundedTrigger({ tool: 'Bash', words }, [COMMIT])).toBe(null)
  }
  for (const raw of [null, 'Bash', [], { words: ['git'] }, { tool: '', words: ['git'] }]) expect(groundedTrigger(raw, [COMMIT])).toBe(null)
})

test('a stored trigger is checked for its shape only', () => {
  expect(parseTrigger({ tool: 'Bash', words: ['git', 'push'] })).toEqual({ tool: 'Bash', words: ['git', 'push'] })
  expect(parseTrigger({ tool: 'Bash', words: ['git push'] })).toBe(null)
  expect(parseTrigger(undefined)).toBe(null)
})

test('a trigger and a call are shown on one short line', () => {
  expect(showTrigger({ tool: 'Bash', words: ['git', 'commit'] })).toBe('Bash: git commit')
  expect(useLine(COMMIT, 200)).toBe('Bash: git commit -m "Fix the Maze" Commit')
  expect(useLine({ tool: 'Bash', input: { command: `a\n${'x'.repeat(300)}` } }, 20).length).toBe(20)
})
