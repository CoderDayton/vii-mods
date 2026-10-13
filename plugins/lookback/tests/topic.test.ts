import { expect, test } from 'claude-code/testing'

import { candidatesOf, isWord, onTopic, topicTerms } from '../src/core/search/topic'

test('a number, a hash and a short token are not words a topic is named by', () => {
  for (const term of ['638', 'd67b3f2', '0x27354e2', 'v8', 'run_1522', 'ab']) expect(isWord(term)).toBe(false)
  for (const term of ['rebuild', 'lm_head', 'tcq2', 'gamemode']) expect(isWord(term)).toBe(true)
})

test('the candidates of a text are its words, each with how often it is said, without the ones to skip', () => {
  const found = candidatesOf('Rebuilt the blueprint. The blueprint is in commit d67b3f2, 638 lines; rebuild took 40 s.', ['rebuild'])
  expect(found).toEqual([
    { term: 'rebuilt', said: 1 },
    { term: 'blueprint', said: 2 },
    { term: 'commit', said: 1 },
    { term: 'lines', said: 1 },
    { term: 'took', said: 1 },
  ])
})

test('topic words are said often in the text and held by few entries', () => {
  const candidates = [
    { term: 'blueprint', said: 4 },
    { term: 'commit', said: 1 },
    { term: 'gamemode', said: 1 },
    { term: 'typo', said: 3 },
    { term: 'thing', said: 2 },
  ]
  const held = [20, 400, 20, 1, 9000]
  expect(topicTerms(candidates, held, 10_000)).toEqual(['blueprint', 'gamemode', 'commit'])
  expect(topicTerms(candidates, held, 10_000, 1)).toEqual(['blueprint'])
})

test('an entry is on topic when it holds three of the topic words, or all of them when there are fewer', () => {
  const topic = ['blueprint', 'rebuild', 'gamemode', 'install']
  expect(onTopic('Rebuilt? No: the blueprint REBUILD ran after the install', topic)).toBe(true)
  expect(onTopic('the blueprint rebuild is next', topic)).toBe(false)
  expect(onTopic('the blueprint rebuild is next', ['blueprint', 'rebuild'])).toBe(true)
  expect(onTopic('anything at all', [])).toBe(false)
})
