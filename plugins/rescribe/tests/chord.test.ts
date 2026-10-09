import { expect, test } from 'claude-code/testing'

import { findChord, prettyChord } from '../src/chord'

const file = (blocks: unknown): string => JSON.stringify({ bindings: blocks })

test('a chord is written the way a person says it', () => {
  expect(prettyChord('ctrl+x r')).toBe('Ctrl+X R')
  expect(prettyChord('ctrl+alt+e')).toBe('Ctrl+Alt+E')
  expect(prettyChord('meta+p')).toBe('Alt+P')
  expect(prettyChord('ctrl+x enter')).toBe('Ctrl+X Enter')
  expect(prettyChord('ctrl+shift+b')).toBe('Ctrl+Shift+B')
  expect(prettyChord('cmd+k')).toBe('Cmd+K')
})

test('the key bound to the action is found', () => {
  const json = file([{ context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos', 'ctrl+x r': 'app:toggleDiffNoiseFilter' } }])
  expect(findChord(json, 'app:toggleDiffNoiseFilter')).toBe('Ctrl+X R')
})

test('a Global binding wins over one in another context', () => {
  const json = file([
    { context: 'Chat', bindings: { 'ctrl+y': 'app:toggleDiffNoiseFilter' } },
    { context: 'Global', bindings: { 'ctrl+x r': 'app:toggleDiffNoiseFilter' } },
  ])
  expect(findChord(json, 'app:toggleDiffNoiseFilter')).toBe('Ctrl+X R')
})

test('no binding, bad JSON or an odd shape gives nothing', () => {
  expect(findChord(file([{ context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } }]), 'app:toggleDiffNoiseFilter')).toBeNull()
  expect(findChord('{ not json', 'app:toggleDiffNoiseFilter')).toBeNull()
  expect(findChord('[]', 'app:toggleDiffNoiseFilter')).toBeNull()
  expect(findChord(JSON.stringify({ bindings: 'no' }), 'app:toggleDiffNoiseFilter')).toBeNull()
})
