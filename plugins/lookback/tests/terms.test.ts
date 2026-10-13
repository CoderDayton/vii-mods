import { expect, test } from 'claude-code/testing'

import { rarest, termsOf, wordsNeeded } from '../src/core/text/terms'

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

test('the rarest terms are kept, in the order they were written', () => {
  const terms = ['file', 'test', 'zebrafish', 'build', 'quokka']
  expect(rarest(terms, [900, 700, 2, 400, 1], 3)).toEqual(['zebrafish', 'build', 'quokka'])
})

test('terms that no entry holds go before the rest, and a tie keeps the earlier term', () => {
  expect(rarest(['a1', 'b2', 'c3', 'd4'], [0, 5, 5, 5], 2)).toEqual(['b2', 'c3'])
})

test('a short question needs one word, a longer one two fifths of its words', () => {
  expect([0, 1, 2].map(wordsNeeded)).toEqual([1, 1, 1])
  expect([3, 4, 5, 6, 7, 8].map(wordsNeeded)).toEqual([2, 2, 2, 3, 3, 4])
})

test('a list that fits is left as it is', () => {
  expect(rarest(['a1', 'b2'], [9, 0], 5)).toEqual(['a1', 'b2'])
})

test('a text with nothing but filler has no terms', () => {
  expect(termsOf('what was that again?')).toEqual([])
  expect(termsOf('')).toEqual([])
})
