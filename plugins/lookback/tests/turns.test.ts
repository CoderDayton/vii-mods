import { expect, test } from 'claude-code/testing'

import { argvOf, requestOf } from '../src/core/call'
import type { Request } from '../src/core/call'
import { sameError, weightOf } from '../src/core/search/fix'
import { formatSession } from '../src/core/search/session'
import { holdsEvery } from '../src/core/text/terms'
import { entriesOf } from '../src/core/transcript/entries'

const row = (fields: Record<string, unknown>): string => JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/work/app', timestamp: '2026-10-09T10:00:00.000Z', ...fields })

const PEER = 'Another Claude session sent a message:\n<cross-session-message from="uds:/x.sock" from-name="boss">\nTask from boss: delete the dead code.\n</cross-session-message>'

test('a message from another Claude session is the prompt of its turn, without its wrapper', () => {
  const line = row({ isMeta: true, origin: { kind: 'peer', from: 'uds:/x.sock' }, message: { content: PEER } })
  expect(entriesOf(line).map(e => [e.kind, e.text])).toEqual([['user', 'Task from boss: delete the dead code.']])
})

test('other rows the harness writes for itself are still left out', () => {
  expect(entriesOf(row({ isMeta: true, message: { content: 'Base directory for this skill: /x' } }))).toEqual([])
  expect(entriesOf(row({ isMeta: true, origin: { kind: 'plugin' }, message: { content: PEER } }))).toEqual([])
})

test('a notice that a background task ended is not something the user said', () => {
  const notice = '<task-notification>\n<task-id>b6z</task-id>\n<summary>Background command "Build" completed (exit code 0)</summary>\n</task-notification>'
  expect(entriesOf(row({ message: { content: notice } }))).toEqual([])
  expect(entriesOf(row({ message: { content: `${notice}\nNow run the tests.` } })).map(e => e.text)).toEqual(['Now run the tests.'])
})

test('a run with no person at the prompt is left out', () => {
  expect(entriesOf(row({ entrypoint: 'sdk-cli', message: { content: '<saved_rules> (none) </saved_rules>' } }))).toEqual([])
  expect(entriesOf(row({ entrypoint: 'cli', message: { content: 'Fix the build.' } })).map(e => e.text)).toEqual(['Fix the build.'])
})

test('a text holds every word of a question only when none is missing', () => {
  expect(holdsEvery('if (count < MISSES_BEFORE_DROP) continue', ['misses_before_drop'])).toBe(true)
  expect(holdsEvery('The frame rate fell in the meadow.', ['frame', 'rate', 'garden'])).toBe(false)
  expect(holdsEvery('anything', [])).toBe(false)
})

test('an error is the same one when the words it shares carry most of the weight', () => {
  const weights = new Map([['error', 0.1], ['argument', 0.3], ['type', 0.2], ['ts2345', 4]])
  expect(sameError('error TS2345: Argument of type string', weights)).toBe(true)
  expect(sameError('1 validation error for call: missing argument of type', weights)).toBe(false)
  expect(sameError('anything', new Map())).toBe(false)
})

test('a word seen in few past errors weighs more than one seen in most', () => {
  expect(weightOf(1, 1000) > weightOf(900, 1000) * 5).toBe(true)
  expect(weightOf(0, 1000) >= weightOf(1, 1000)).toBe(true)
})

test('kinds narrow a search or a session read', () => {
  expect(argvOf(requestOf({ query: 'x', kind: ['user', 'assistant'] }) as Request, { limit: 5 })).toEqual(['search', '--limit', '5', '--kind', 'user', '--kind', 'assistant', '--', 'x'])
  expect(argvOf(requestOf({ session: 'abcd1234', kind: ['user'] }) as Request, { limit: 5 })).toEqual(['show', '--offset', '0', '--kind', 'user', '--', 'abcd1234'])
})

test('a kind that does not exist is refused, with the ones that do', () => {
  expect(requestOf({ query: 'x', kind: ['note'] })).toEqual({ error: '"kind" must be a list of: user, assistant, thinking, error, cmd, edit' })
  expect(requestOf({ query: 'x', kind: 'user' })).toEqual({ error: '"kind" must be a list of: user, assistant, thinking, error, cmd, edit' })
})

test('an offset past the last entry of a session says how many there are', () => {
  const summary = { session: 'd18dbf28-1111-2222-3333-444444444444', project: '/work/app', first: 0, last: 0, entries: 32 }
  expect(formatSession(summary, [], { offset: 40, maxChars: 2000, entryChars: 100 }).split('\n').at(-1)).toBe('… no entries past 32')
})
