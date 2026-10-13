import { expect, test } from 'claude-code/testing'

import { answers, sharedTerms, tellingTerms, worthAsking } from '../src/core/search/gate'

test('a prompt that is a command, a tool output or too short is not worth a search', () => {
  for (const text of ['/code-review medium --fix', '<bash-stdout>done</bash-stdout>', 'ok do it', '   ']) expect(worthAsking(text)).toBe(false)
  expect(worthAsking('start calling Starter Zone by its name in the shop')).toBe(true)
})

test('a word held by many entries does not tell entries apart', () => {
  const terms = ['release', 'branch', 'the', 'ghost']
  expect(tellingTerms(terms, [40, 12, 9000, 0], 10_000)).toEqual(['release', 'branch'])
})

test('shared terms are the ones the text holds, whatever their case', () => {
  expect(sharedTerms('Move the commits to a new Release branch', ['release', 'branch', 'tag'])).toEqual(['release', 'branch'])
})

test('an entry answers a prompt when it means nearly the same and shares two telling words', () => {
  const telling = ['release', 'branch']
  expect(answers(0.9, 'a new release branch for the commits', telling)).toBe(true)
  expect(answers(0.8, 'a new release branch for the commits', telling)).toBe(true)
  expect(answers(0.75, 'a new release branch for the commits', telling)).toBe(false)
  expect(answers(0.9, 'a new release for the commits', telling)).toBe(false)
})
