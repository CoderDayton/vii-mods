import { expect, test } from 'claude-code/testing'

import { rowOf } from '../src/core/transcript/entries'
import { pastesOfRow } from '../src/core/transcript/pastes'

const TS = Date.parse('2026-10-09T10:00:00.000Z')
const PNG = btoa('png bytes')
const JPG = btoa('jpeg bytes')

const image = (media: string, data: string): Record<string, unknown> => ({ type: 'image', source: { type: 'base64', media_type: media, data } })

const row = (fields: Record<string, unknown>): string =>
  JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/work/app', timestamp: '2026-10-09T10:00:00.000Z', uuid: 'u1', ...fields })

const pastes = (line: string) => pastesOfRow(rowOf(line))

test('each image a person pasted into a prompt is found, keyed by its place in the row', () => {
  const line = row({ message: { role: 'user', content: [{ type: 'text', text: '[Image #1] [Image #2] what broke here?' }, image('image/png', PNG), image('image/jpeg', JPG)] } })
  expect(pastes(line)).toEqual([
    { key: 'u1:i1', session: 's1', project: '/work/app', ts: TS, media: 'image/png', data: PNG },
    { key: 'u1:i2', session: 's1', project: '/work/app', ts: TS, media: 'image/jpeg', data: JPG },
  ])
})

test('an image a tool returned is not a paste', () => {
  const line = row({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image('image/png', PNG)] }] } })
  expect(pastes(line)).toEqual([])
})

test("a sub-agent's paste belongs to the agent's run, with the session that started it", () => {
  const line = row({ isSidechain: true, agentId: 'a7', message: { role: 'user', content: [image('image/png', PNG)] } })
  expect(pastes(line)).toEqual([{ key: 'u1:i0', session: 'a7', parent: 's1', project: '/work/app', ts: TS, media: 'image/png', data: PNG }])
})

test('rows a person did not type, Claude rows, and images of an unknown type or with no data give none', () => {
  const content = [image('image/png', PNG)]
  expect(pastes(row({ isMeta: true, message: { role: 'user', content } }))).toEqual([])
  expect(pastes(row({ entrypoint: 'sdk-cli', message: { role: 'user', content } }))).toEqual([])
  expect(pastes(row({ type: 'assistant', message: { role: 'assistant', content } }))).toEqual([])
  expect(pastes(row({ message: { role: 'user', content: [image('image/tiff', PNG), image('image/png', ''), { type: 'image', source: { type: 'url', url: 'https://x/y.png' } }] } }))).toEqual([])
  expect(pastes(row({ message: { role: 'user', content: 'plain text' } }))).toEqual([])
  expect(pastesOfRow(null)).toEqual([])
})

test('a row with no id gives pastes with no key', () => {
  const line = JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/work/app', timestamp: '2026-10-09T10:00:00.000Z', message: { role: 'user', content: [image('image/webp', PNG)] } })
  expect(pastes(line)).toEqual([{ session: 's1', project: '/work/app', ts: TS, media: 'image/webp', data: PNG }])
})
