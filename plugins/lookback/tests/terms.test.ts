import { expect, test } from 'claude-code/testing'

import { termsOf } from '../src/core/text/terms'

test('words that only frame a question about the past are dropped', () => {
  expect(termsOf("didn't we fix the ModuleNotFoundError last time?")).toEqual(['fix', 'modulenotfounderror'])
})

test('identifiers and error codes stay whole, case folded', () => {
  expect(termsOf('parse_ledger threw ENOENT in useVectors')).toEqual(['parse_ledger', 'threw', 'enoent', 'usevectors'])
})

test('a path or a flag splits into its words', () => {
  expect(termsOf('src/core/fuse.ts --max-tokens')).toEqual(['src', 'core', 'fuse', 'ts', 'max', 'tokens'])
})

test('a term is kept once, one-letter words go, and the list is capped', () => {
  expect(termsOf('cache Cache a b cache')).toEqual(['cache'])
  expect(termsOf('one two three four five six seven eight nine ten', 4)).toEqual(['one', 'two', 'three', 'four'])
})

test('a text with nothing but filler has no terms', () => {
  expect(termsOf('what was that again?')).toEqual([])
  expect(termsOf('')).toEqual([])
})
