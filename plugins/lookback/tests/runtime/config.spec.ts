import { expect, test } from 'bun:test'

import { configFrom } from '../../src/runtime/config'

test('the defaults put the index under the data folder and read the Claude Code transcripts', () => {
  expect(configFrom({ HOME: '/home/u' })).toEqual({
    projectsRoot: '/home/u/.claude/projects',
    databasePath: '/home/u/.local/share/lookback/index.sqlite',
    fileTools: undefined,
    embedding: { baseURL: 'http://localhost:11434/v1', model: 'nomic-embed-text', apiKey: 'ollama' },
    caption: { named: false, server: '', model: '', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' },
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
    LOOKBACK_FILE_TOOLS: 'mcp__files',
    LOOKBACK_CAPTION_SERVER: 'llama-server -m v.gguf',
    LOOKBACK_CAPTION_MODEL: 'vl',
    LOOKBACK_CAPTION_URL: 'http://gpu-box:8080/v1',
    LOOKBACK_CAPTION_KEY: 'other',
  })
  expect(config).toEqual({
    projectsRoot: '/t/projects',
    databasePath: '/t/index.sqlite',
    fileTools: 'mcp__files',
    embedding: { baseURL: 'http://gpu-box:11434/v1', model: 'mxbai-embed-large', apiKey: 'secret' },
    caption: { named: true, server: 'llama-server -m v.gguf', model: 'vl', baseURL: 'http://gpu-box:8080/v1', apiKey: 'other' },
  })
  expect(configFrom({ HOME: '/home/u', LOOKBACK_EMBEDDING_MODEL: '' }).embedding.model).toBe('nomic-embed-text')
})

test('the file tools are unset when the variable is, and none when it is empty', () => {
  expect(configFrom({ HOME: '/home/u' }).fileTools).toBeUndefined()
  expect(configFrom({ HOME: '/home/u', LOOKBACK_FILE_TOOLS: '' }).fileTools).toBe('')
})

test('captions are named by either variable, even an empty one, so a run by hand with neither keeps what the index does', () => {
  expect(configFrom({ HOME: '/home/u' }).caption.named).toBe(false)
  expect(configFrom({ HOME: '/home/u', LOOKBACK_CAPTION_SERVER: '' }).caption.named).toBe(true)
  expect(configFrom({ HOME: '/home/u', LOOKBACK_CAPTION_MODEL: 'vl' }).caption.named).toBe(true)
  expect(configFrom({ HOME: '/home/u', LOOKBACK_CAPTION_URL: 'http://x/v1' }).caption.named).toBe(false)
})

test('a missing HOME is an error, not a path under the working directory', () => {
  expect(() => configFrom({})).toThrow(/HOME/)
})
