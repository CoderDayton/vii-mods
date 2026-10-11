import { expect, test } from 'claude-code/testing'

import { chunksOf } from '../src/core/text/chunk'

test('a short text is one chunk and an empty one is none', () => {
  expect(chunksOf('A short note.')).toEqual(['A short note.'])
  expect(chunksOf('   \n  ')).toEqual([])
})

test('paragraphs are packed in order, each chunk within the limit', () => {
  const paragraph = (c: string) => c.repeat(40)
  const text = [paragraph('a'), paragraph('b'), paragraph('c'), paragraph('d')].join('\n\n')
  const chunks = chunksOf(text, { maxChars: 100, maxChunks: 10 })
  expect(chunks).toEqual([`${paragraph('a')}\n\n${paragraph('b')}`, `${paragraph('c')}\n\n${paragraph('d')}`])
  expect(chunks.every(c => c.length <= 100)).toBe(true)
})

test('a paragraph over the limit is cut at a sentence end or a space', () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} says something.`).join(' ')
  const chunks = chunksOf(sentences, { maxChars: 120, maxChunks: 10 })
  expect(chunks.length).toBeGreaterThan(2)
  expect(chunks.every(c => c.length <= 120)).toBe(true)
  expect(chunks.every(c => c.endsWith('.'))).toBe(true)
  expect(chunks.join(' ')).toBe(sentences)
})

test('a word longer than the limit is cut hard', () => {
  const chunks = chunksOf('x'.repeat(250), { maxChars: 100, maxChunks: 10 })
  expect(chunks.map(c => c.length)).toEqual([100, 100, 50])
})

test('no more chunks than the cap are kept, the first ones', () => {
  const text = Array.from({ length: 10 }, (_, i) => String(i).repeat(90)).join('\n\n')
  const chunks = chunksOf(text, { maxChars: 100, maxChunks: 3 })
  expect(chunks).toHaveLength(3)
  expect(chunks[0]).toBe('0'.repeat(90))
})
