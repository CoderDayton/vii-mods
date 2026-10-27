import { expect, test } from 'claude-code/testing'

import { ALREADY_SENT, cutSent } from '../src/core/seen'

const HEAD = '2026-10-12  claude-mods  f8fbdc59  Autonomous team task delegation'
const ASKED = '  asked     Well, can you put the session in the output so the model sorts it?'
const SAID = '  assistant It leaves the sorting to the model. Nothing is committed yet, sorry.'
const OTHER = '2026-10-08  claude-mods  4ad769a8  Fleet mod boss review'
const NEW = '  asked     Does reloading the plugin in one session reload it for all of them?'

test('a first result is sent whole, and its lines are remembered', () => {
  const text = `${HEAD}\n${ASKED}\n${SAID}`
  const out = cutSent(text, new Set())
  expect(out.text).toBe(text)
  expect(out.sent).toEqual([ASKED.trim(), SAID.trim()])
})

test('a session block sent before keeps its first line and says the rest was sent', () => {
  const out = cutSent(`${HEAD}\n${ASKED}\n${SAID}\n\n${OTHER}\n${NEW}`, new Set([ASKED.trim(), SAID.trim()]))
  expect(out.text).toBe(`${HEAD}\n  ${ALREADY_SENT}\n\n${OTHER}\n${NEW}`)
  expect(out.sent).toEqual([NEW.trim()])
})

test('a block with some lines sent before keeps the new ones and counts the rest', () => {
  const out = cutSent(`${HEAD}\n${ASKED}\n${NEW}`, new Set([ASKED.trim()]))
  expect(out.text).toBe(`${HEAD}\n${NEW}\n  … 1 more line ${ALREADY_SENT}`)
})

test('short lines and the last line of a page are never cut', () => {
  const page = '… 3 more sessions: call again with offset 5'
  const out = cutSent(`${HEAD}\n  then ran  ls\n\n${page}`, new Set(['then ran  ls', page]))
  expect(out.text).toBe(`${HEAD}\n  then ran  ls\n\n${page}`)
})
