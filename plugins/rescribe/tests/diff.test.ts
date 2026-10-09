import { expect, test } from 'claude-code/testing'

import { diffPairs, markChanges } from '../src/diff'
import type { Seg } from '../src/diff'

const joined = (segs: readonly Seg[]): string => segs.map(s => s.text).join('')

test('a changed word is marked on both sides', () => {
  const r = markChanges('clear the cash now', 'clear the cache now')
  expect(r.before).toEqual([
    { text: 'clear the ', isChanged: false },
    { text: 'cash', isChanged: true },
    { text: ' now', isChanged: false },
  ])
  expect(r.after).toEqual([
    { text: 'clear the ', isChanged: false },
    { text: 'cache', isChanged: true },
    { text: ' now', isChanged: false },
  ])
})

test('a removed word is marked before and leaves the after side whole', () => {
  const r = markChanges('run the old build', 'run the build')
  expect(r.before).toEqual([
    { text: 'run the ', isChanged: false },
    { text: 'old', isChanged: true },
    { text: ' build', isChanged: false },
  ])
  expect(r.after).toEqual([{ text: 'run the build', isChanged: false }])
})

test('an added word is marked after and leaves the before side whole', () => {
  const r = markChanges('run build', 'run the build')
  expect(r.before).toEqual([{ text: 'run build', isChanged: false }])
  expect(r.after).toEqual([
    { text: 'run ', isChanged: false },
    { text: 'the', isChanged: true },
    { text: ' build', isChanged: false },
  ])
})

test('identical and empty text have no changed segments', () => {
  expect(markChanges('same text', 'same text')).toEqual({
    before: [{ text: 'same text', isChanged: false }],
    after: [{ text: 'same text', isChanged: false }],
  })
  expect(markChanges('', '')).toEqual({ before: [], after: [] })
})

test('the segments always rebuild the original text, whitespace included', () => {
  const before = '  make the cash layer,\n\nno wait, make the retry layer  '
  const after = 'make the retry layer'
  const r = markChanges(before, after)
  expect(joined(r.before)).toBe(before)
  expect(joined(r.after)).toBe(after)
  expect(r.before.some(s => s.isChanged)).toBe(true)
})

test('words with accents and non-Latin letters are compared as words', () => {
  expect(diffPairs('ändere die größe', 'Ändere die Größe')).toEqual([
    { heard: 'ändere', meant: 'Ändere' },
    { heard: 'größe', meant: 'Größe' },
  ])
  const r = markChanges('prüfe das wörd', 'prüfe das word')
  expect(r.before.find(s => s.isChanged)?.text).toBe('wörd')
  expect(r.after.find(s => s.isChanged)?.text).toBe('word')
})

test('diffPairs lists each changed run as heard and meant', () => {
  expect(diffPairs('use olama and the cash', 'use Ollama and the cache')).toEqual([
    { heard: 'olama', meant: 'Ollama' },
    { heard: 'cash', meant: 'cache' },
  ])
  expect(diffPairs('run the old build', 'run the build')).toEqual([{ heard: 'old', meant: '' }])
  expect(diffPairs('run build', 'run the build')).toEqual([{ heard: '', meant: 'the' }])
})


