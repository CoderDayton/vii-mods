import { expect, test } from 'claude-code/testing'

import { readOptions } from '../src/core/options'

test('the defaults are five sessions, recall, indexing and error hints on, Ollama and nomic-embed-text', () => {
  expect(readOptions({})).toEqual({
    limit: 5,
    autoRecall: true,
    autoIndex: true,
    errorHints: true,
    sessionDigest: true,
    fileNotes: true,
    fileTools: '',
    embeddingModel: 'nomic-embed-text',
    embeddingUrl: 'http://localhost:11434/v1',
    captionServer: '',
    captionModel: '',
    captionUrl: 'http://localhost:11434/v1',
  })
})

test('values are taken, and the limit is kept in range', () => {
  const options = readOptions({ limit: 9, autoRecall: false, autoIndex: false, errorHints: false, sessionDigest: false, fileNotes: false, fileTools: ' mcp__files ', embeddingModel: 'mxbai-embed-large', embeddingUrl: 'http://gpu:11434/v1', captionServer: ' llama-server -m m.gguf ', captionModel: 'lfm2.5-vl', captionUrl: 'http://gpu:8080/v1' })
  expect(options).toEqual({
    limit: 9,
    autoRecall: false,
    autoIndex: false,
    errorHints: false,
    sessionDigest: false,
    fileNotes: false,
    fileTools: 'mcp__files',
    embeddingModel: 'mxbai-embed-large',
    embeddingUrl: 'http://gpu:11434/v1',
    captionServer: 'llama-server -m m.gguf',
    captionModel: 'lfm2.5-vl',
    captionUrl: 'http://gpu:8080/v1',
  })
  expect(readOptions({ limit: 0 }).limit).toBe(1)
  expect(readOptions({ limit: 99 }).limit).toBe(15)
  expect(readOptions({ limit: 2.7 }).limit).toBe(2)
})

test('a blank or non-text model or address falls back to the default', () => {
  expect(readOptions({ embeddingModel: '  ', embeddingUrl: 7 }).embeddingModel).toBe('nomic-embed-text')
  expect(readOptions({ embeddingUrl: '' }).embeddingUrl).toBe('http://localhost:11434/v1')
})
