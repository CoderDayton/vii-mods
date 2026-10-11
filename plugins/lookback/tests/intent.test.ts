import { expect, test } from 'claude-code/testing'

import { asksAboutPast } from '../src/core/search/intent'

test('a prompt that asks about earlier work is one to recall for', () => {
  for (const text of [
    "didn't we fix this error before?",
    'what was that command we used last time',
    'Remember when we changed the pane layout?',
    'how did we handle the lock earlier',
    'we already did this in another session',
    'what did we decide about the schema',
  ]) {
    expect(asksAboutPast(text)).toBe(true)
  }
})

test('an ordinary request is not', () => {
  for (const text of [
    'fix the failing test',
    'add a retry to the fetch call',
    'what does this function return?',
    'commit',
    'I have not tested the last version of the file',
  ]) {
    expect(asksAboutPast(text)).toBe(false)
  }
})
