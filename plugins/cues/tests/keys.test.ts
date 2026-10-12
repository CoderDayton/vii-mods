import { expect, test } from 'claude-code/testing'

import { clipForChar, clipForKey, pressClips, releaseClips } from '../src/keys'

test('a character sounds like the keyboard row it sits on', () => {
  expect(clipForChar('7')).toBe('r0')
  expect(clipForChar('q')).toBe('r1')
  expect(clipForChar('G')).toBe('r2')
  expect(clipForChar('/')).toBe('r3')
  expect(clipForChar('%')).toBe('r0')
})

test('space, a line break and anything off the board have their own clips', () => {
  expect(clipForChar(' ')).toBe('space')
  expect(clipForChar('\n')).toBe('enter')
  expect(clipForChar('é')).toBe('r4')
})

test('a named key of the prompt box maps to its clip', () => {
  expect(clipForKey('space')).toBe('space')
  expect(clipForKey('Return')).toBe('enter')
  expect(clipForKey('backspace')).toBe('backspace')
  expect(clipForKey('delete')).toBe('backspace')
  expect(clipForKey('k')).toBe('r2')
  expect(clipForKey('left')).toBe('r4')
})

test('a press names its own clip first, then a row clip every switch has', () => {
  expect(pressClips('topre', 'r1')).toEqual(['keys/topre/press/r1'])
  expect(pressClips('mxblue', 'space')).toEqual(['keys/mxblue/press/space', 'keys/mxblue/press/r4'])
  expect(pressClips('mxblue', 'enter')).toEqual(['keys/mxblue/press/enter', 'keys/mxblue/press/r2'])
})

test('a release falls back to the plain key release', () => {
  expect(releaseClips('topre', 'r3')).toEqual(['keys/topre/release/key'])
  expect(releaseClips('topre', 'space')).toEqual(['keys/topre/release/space', 'keys/topre/release/key'])
})
