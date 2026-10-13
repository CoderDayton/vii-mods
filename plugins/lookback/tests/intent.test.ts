import { expect, test } from 'claude-code/testing'

import { asksAboutPast, pastCues } from '../src/core/search/intent'

const all = (texts: readonly string[], want: boolean): void => {
  for (const text of texts) expect(`${text} => ${asksAboutPast(text)}`).toBe(`${text} => ${want}`)
}

test('a prompt that asks about earlier work is one to recall for', () => {
  all(["didn't we fix this error before?", 'what was that command we used last time', 'Remember when we changed the pane layout?', 'how did we handle the lock earlier', 'we already did this in another session', 'what did we decide about the schema'], true)
})

test('an ordinary request is not', () => {
  all(['fix the failing test', 'add a retry to the fetch call', 'what does this function return?', 'commit', 'I have not tested the last version of the file'], false)
})

test('a question about what Claude or the user did counts, in texting spelling too', () => {
  all(['uh did u rebuild it?', 'did u not find lua_State?', 'Did you reinstall the plug-ins?', 'didnt you already edit lunetrains mixing?', 'Did we push to our forks main?', 'Oh, did I tell you I imported it?', 'why did u delete the 1 hour mix?', 'Why have you chosen to reuse the reference pipelines?', 'what did u do?', 'howd u get confused about the door?'], true)
})

test('a contracted "have" counts like the whole word', () => {
  all(["we've already fixed this flaky test", "you've already edited the mixer", "I think we've decided on the schema"], true)
})

test('a question about an earlier result, reason or choice counts', () => {
  all(['what was the reason we changed it', 'what was the other broken style?', 'What was the v5 accuracy on that split?', 'how many samples was v0.1?', 'What are the sets again?', 'what features were we missing again'], true)
})

test('a pointer to what was said, shown or decided counts', () => {
  all(
    [
      'You see the Lune Voice you said that has a space?',
      'Yeah, you edited the readme, right, like you said?',
      'Do you not see the example that I gave you?',
      'It was determined in another session that TCQ beats NF',
      'You have to have the correct settings on. Look at the other session',
      'btw we measured this before, check the history',
      "I'm pretty sure we had the expert offloaded, didn't we?",
      'im sure we talked about this but i forgot',
      'can you run the examples from earlier with the 0 flip chance',
      'The rebuild peaked at 1.7 GB, up from about 1 GB last time.',
    ],
    true,
  )
})

test('a request to put something back the way it was counts', () => {
  all(['go back to the old version of that hint effect', 'ok revert back to your original one', 'go back to the not AlwaysOnTop, i liked it before'], true)
})

test('a report, a what-if and a fresh request that only use the past tense do not count', () => {
  all(
    [
      'ok did it',
      'Ok did it. With it on, it still lags, off is perfect fps.',
      'i ran the two commands, can you do number 2',
      'I reimported it, check the planter in Studio',
      'What if we did a light training run, unmerged?',
      'Hmm, what if it was a hybrid?',
      'what if you ensembled Laya onto v4?',
      'make custom sparkles that look like they where made for a AAA game.',
      'you crashed my studio, check if everything is saved',
      'I meant like the actual seed size itself, you know?',
      'did ci fail?',
      'Okay, did that fix it?',
      'undo what u just did first',
      'see what made it crash just now',
      'how long left',
      'So why did the model only choose to capitalize this?',
    ],
    false,
  )
})

test('text that is quoted, pasted or code is not read', () => {
  all(['rename the test to "did we fix this before"', 'fix this:\n```\n// what did we decide last time\n```', 'the log says `did you already run it`'], false)
})

test('the cues found are named, for tuning', () => {
  expect(pastCues('uh did u rebuild it?')).toEqual(['did-you'])
  expect(pastCues('fix the failing test')).toEqual([])
})
