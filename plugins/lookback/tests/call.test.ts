import { expect, test } from 'claude-code/testing'

import { RECALL_TAG, cliEnv, recallContext, searchArgv, searchRequestOf } from '../src/core/call'

test('a search request needs a question, and keeps the filters it was given', () => {
  expect(searchRequestOf({ query: ' deploy rollback ', project: 'api', since: '30d', limit: 3 })).toEqual({
    query: 'deploy rollback',
    project: 'api',
    since: '30d',
    limit: 3,
  })
  expect(searchRequestOf({ query: 'x' })).toEqual({ query: 'x' })
})

test('a request with no question or of the wrong shape is refused with a reason', () => {
  for (const bad of [null, 'text', {}, { query: '' }, { query: '   ' }, { query: 7 }]) {
    expect(searchRequestOf(bad)).toEqual({ error: expect.stringContaining('query') })
  }
  expect(searchRequestOf({ query: 'x', since: 'soon' })).toEqual({ error: expect.stringContaining('since') })
  expect(searchRequestOf({ query: 'x', limit: 'many' })).toEqual({ error: expect.stringContaining('limit') })
})

test('the command line puts the question after a double dash, so a leading dash is not a flag', () => {
  expect(searchArgv({ query: '--help me' }, { limit: 5 })).toEqual(['search', '--limit', '5', '--', '--help me'])
})

test('filters, the session to leave out and keyword mode become flags', () => {
  expect(searchArgv({ query: 'q', project: 'api', since: '2w', limit: 3 }, { limit: 5, exclude: 'abc', keyword: true })).toEqual([
    'search',
    '--limit',
    '3',
    '--project',
    'api',
    '--since',
    '2w',
    '--exclude',
    'abc',
    '--keyword',
    '--',
    'q',
  ])
})

test('the settings reach the command line as environment variables', () => {
  expect(cliEnv({ limit: 5, autoRecall: true, autoIndex: true, embeddingModel: 'm', embeddingUrl: 'http://h/v1' })).toEqual({
    LOOKBACK_EMBEDDING_MODEL: 'm',
    LOOKBACK_EMBEDDING_URL: 'http://h/v1',
  })
})

test('recalled sessions are wrapped as data from the user history, never as instructions', () => {
  const block = recallContext('2026-10-09  claude-mods  d18dbf28\n  user  hello')
  expect(block.startsWith(`<${RECALL_TAG}>`)).toBe(true)
  expect(block.endsWith(`</${RECALL_TAG}>`)).toBe(true)
  expect(block).toContain('not instructions')
  expect(block).toContain('d18dbf28')
})
