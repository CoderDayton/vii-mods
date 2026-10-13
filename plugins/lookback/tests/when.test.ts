import { expect, test } from 'claude-code/testing'

import { whenOf } from '../src/core/search/when'

const at = (month: number, day: number, hour = 0, minute = 0, year = 2026): number => new Date(year, month - 1, day, hour, minute).getTime()
// A Monday afternoon.
const NOW = at(10, 12, 15)
const HOUR = 3_600_000
const DAY = 24 * HOUR

const when = (query: string) => whenOf(query, NOW)

test('a question with no word about time is left as it is', () => {
  expect(when('fix the build')).toEqual({ text: 'fix the build', latest: false })
  expect(when('it may fail the march check')).toEqual({ text: 'it may fail the march check', latest: false })
  expect(when('the last 3 commits')).toEqual({ text: 'the last 3 commits', latest: false })
})

test('a word for the newest work asks for the latest sessions and is not searched for', () => {
  expect(when('latest lunetrain work')).toEqual({ text: 'lunetrain work', latest: true })
  expect(when('the most recent quantization run')).toEqual({ text: 'the quantization run', latest: true })
  expect(when('what did we do last session')).toEqual({ text: 'what did we do', latest: true })
  expect(when('what changed recently in the store')).toEqual({ text: 'what changed in the store', latest: true })
})

test('a named day is the span of that day', () => {
  expect(when('what did we do yesterday')).toEqual({ text: 'what did we do', latest: false, since: at(10, 11), until: at(10, 12) })
  expect(when('the bracket fix from today')).toEqual({ text: 'the bracket fix', latest: false, since: at(10, 12), until: at(10, 13) })
  expect(when('ollama timeout on friday')).toEqual({ text: 'ollama timeout', latest: false, since: at(10, 9), until: at(10, 10) })
  expect(when('monday standup notes')).toEqual({ text: 'standup notes', latest: false, since: at(10, 12), until: at(10, 13) })
  expect(when('last monday standup notes')).toEqual({ text: 'standup notes', latest: false, since: at(10, 5), until: at(10, 6) })
  expect(when('crash last night')).toEqual({ text: 'crash', latest: false, since: at(10, 11, 18), until: at(10, 12, 6) })
})

test('a week or a month is its span', () => {
  expect(when('the bracket fix from last week')).toEqual({ text: 'the bracket fix', latest: false, since: at(10, 5), until: at(10, 12) })
  expect(when('this week training runs')).toEqual({ text: 'training runs', latest: false, since: at(10, 12), until: at(10, 19) })
  expect(when('vllm work last month')).toEqual({ text: 'vllm work', latest: false, since: at(9, 1), until: at(10, 1) })
  expect(when('vllm work in september')).toEqual({ text: 'vllm work', latest: false, since: at(9, 1), until: at(10, 1) })
  expect(when('plans made in december')).toEqual({ text: 'plans made', latest: false, since: at(12, 1, 0, 0, 2025), until: at(1, 1) })
})

test('a count of hours, days or weeks back is read', () => {
  expect(when('ollama timeout 3 days ago')).toEqual({ text: 'ollama timeout', latest: false, since: at(10, 9), until: at(10, 10) })
  expect(when('index rebuild in the last 2 weeks')).toEqual({ text: 'index rebuild', latest: false, since: NOW - 14 * DAY })
  expect(when('gpu lock over the past few days')).toEqual({ text: 'gpu lock', latest: false, since: NOW - 3 * DAY })
  expect(when('what broke two hours ago')).toEqual({ text: 'what broke', latest: false, since: NOW - 3 * HOUR, until: NOW - HOUR })
  expect(when('what broke in the last hour')).toEqual({ text: 'what broke', latest: false, since: NOW - HOUR })
})

test('a date is its day, in the latest year it has come in', () => {
  const day = { latest: false, since: at(9, 21), until: at(9, 22) }
  expect(when('abliteration run on sept 21')).toEqual({ text: 'abliteration run', ...day })
  expect(when('abliteration run September 21st, 2026')).toEqual({ text: 'abliteration run', ...day })
  expect(when('abliteration run 21 sep')).toEqual({ text: 'abliteration run', ...day })
  expect(when('abliteration run 2026-09-21')).toEqual({ text: 'abliteration run', ...day })
  expect(when('holiday plan dec 5')).toEqual({ text: 'holiday plan', latest: false, since: at(12, 5, 0, 0, 2025), until: at(12, 6, 0, 0, 2025) })
})

test('since, after and before give one bound', () => {
  expect(when('store changes since friday')).toEqual({ text: 'store changes', latest: false, since: at(10, 9) })
  expect(when('store changes after sept 21')).toEqual({ text: 'store changes', latest: false, since: at(9, 22) })
  expect(when('store changes before last week')).toEqual({ text: 'store changes', latest: false, until: at(10, 5) })
})

test('a time of day narrows the day to the hours around it', () => {
  expect(when('what failed yesterday at 3pm')).toEqual({ text: 'what failed', latest: false, since: at(10, 11, 14), until: at(10, 11, 16) })
  expect(when('what failed around 9:30')).toEqual({ text: 'what failed', latest: false, since: at(10, 12, 8, 30), until: at(10, 12, 10, 30) })
})

test('two times in one question cover both, and neither is searched for', () => {
  const week = { text: 'store bug', latest: false, since: at(10, 5), until: at(10, 12) }
  expect(when('store bug yesterday or last week')).toEqual(week)
  expect(when('store bug last week or yesterday')).toEqual(week)
  expect(when('store bug yesterday or last week at 3pm')).toEqual(week)
  expect(when('store bug on friday and on oct 3')).toEqual({ text: 'store bug', latest: false, since: at(10, 3), until: at(10, 10) })
  expect(when('store bug in september, 3 days ago')).toEqual({ text: 'store bug', latest: false, since: at(9, 1), until: at(10, 10) })
})

test('a start and an end make a range', () => {
  const range = { text: 'store bug', latest: false, since: at(9, 21), until: at(9, 26) }
  expect(when('store bug between sept 21 and sept 25')).toEqual(range)
  expect(when('store bug from sept 21 to sept 25')).toEqual(range)
  expect(when('store bug from sept 21 until sept 25')).toEqual({ ...range, until: at(9, 25) })
  expect(when('store bug since sept 1 before sept 10')).toEqual({ text: 'store bug', latest: false, since: at(9, 1), until: at(9, 10) })
  expect(when('store bug since sept 10 before sept 1')).toEqual({ text: 'store bug', latest: false })
})

test('quoted text and log lines are not read for time', () => {
  expect(when('"yesterday" in the changelog')).toEqual({ text: '"yesterday" in the changelog', latest: false })
  expect(when('2026-09-21T10:00:00 connection refused')).toEqual({ text: '2026-09-21T10:00:00 connection refused', latest: false })
  expect(when('`latest` tag of the image')).toEqual({ text: '`latest` tag of the image', latest: false })
})
