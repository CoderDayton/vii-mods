import { expect, test } from 'claude-code/testing'

import { keepsTokens } from '../src/enhance'

test('a text that keeps every image tag, file mention and code span passes', () => {
  const original = 'look at [Image #1] and @src/a.ts and `npm test` then fix it'
  expect(keepsTokens(original, 'look at [Image #1] and @src/a.ts and `npm test` then fix it now')).toBe(true)
})

test('a text that lost an image tag fails', () => {
  const original = 'look at [Image #1] and fix it'
  expect(keepsTokens(original, 'look at Image 1 and fix it')).toBe(false)
})
