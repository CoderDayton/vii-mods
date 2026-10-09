import { expect, test } from 'claude-code/testing'

import { mightCorrect } from '../src/gate'

test('wording that pushes back on what Claude did passes the gate', () => {
  for (const text of [
    'i said we need them the other direction too',
    'the sun crystal im talking about it doesnt go in the SAME LOCATION, it should be in a different location, didnt it say that anywhere?',
    'no, use click not ProximityPrompt',
    'stop adding comments to every function',
    "that's wrong",
    'you still forgot the tests',
    'again, do not edit in blender',
    "don't use semicolons",
    'never use var',
    'I told you to keep the names',
    'use a map instead',
    "it's supposed to loop",
  ]) {
    expect(mightCorrect(text)).toBe(true)
  }
})

test('plain tasks, questions and thanks do not', () => {
  for (const text of [
    'add a login page',
    'how does the lock work?',
    'thanks, looks good',
    'run the tests',
    'ok',
    'rename the function to parse',
  ]) {
    expect(mightCorrect(text)).toBe(false)
  }
})

test('a trigger word counts only as a whole word', () => {
  for (const text of ['I know the answer', 'make a note of it', 'start the stopwatch', 'add another field', 'a stillness']) {
    expect(mightCorrect(text)).toBe(false)
  }
})

test('slash commands, blank text and long briefs are never checked', () => {
  expect(mightCorrect('/rules rm 3')).toBe(false)
  expect(mightCorrect('/gpu no')).toBe(false)
  expect(mightCorrect('   ')).toBe(false)
  expect(mightCorrect('')).toBe(false)
  expect(mightCorrect(`no ${'long brief text '.repeat(60)}`)).toBe(false)
  expect(mightCorrect('no\n1\n2\n3\n4\n5\n6\n7\n8')).toBe(false)
})
