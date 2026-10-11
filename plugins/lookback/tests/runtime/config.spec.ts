import { expect, test } from 'bun:test'

import { configFrom } from '../../src/runtime/config'

test('the defaults put the index under the data folder and read the Claude Code transcripts', () => {
  expect(configFrom({ HOME: '/home/u' })).toEqual({
    projectsRoot: '/home/u/.claude/projects',
    databasePath: '/home/u/.local/share/lookback/index.sqlite',
    embedding: { baseURL: 'http://localhost:11434/v1', model: 'nomic-embed-text', apiKey: 'ollama' },
  })
})

test('XDG_DATA_HOME moves the index', () => {
  expect(configFrom({ HOME: '/home/u', XDG_DATA_HOME: '/data' }).databasePath).toBe('/data/lookback/index.sqlite')
})

test('LOOKBACK_ variables override every setting, and an empty one counts as unset', () => {
  const config = configFrom({
    HOME: '/home/u',
    LOOKBACK_PROJECTS: '/t/projects',
    LOOKBACK_DB: '/t/index.sqlite',
    LOOKBACK_EMBEDDING_URL: 'http://gpu-box:11434/v1',
    LOOKBACK_EMBEDDING_MODEL: 'mxbai-embed-large',
    LOOKBACK_EMBEDDING_KEY: 'secret',
  })
  expect(config).toEqual({
    projectsRoot: '/t/projects',
    databasePath: '/t/index.sqlite',
    embedding: { baseURL: 'http://gpu-box:11434/v1', model: 'mxbai-embed-large', apiKey: 'secret' },
  })
  expect(configFrom({ HOME: '/home/u', LOOKBACK_EMBEDDING_MODEL: '' }).embedding.model).toBe('nomic-embed-text')
})

test('a missing HOME is an error, not a path under the working directory', () => {
  expect(() => configFrom({})).toThrow(/HOME/)
})
