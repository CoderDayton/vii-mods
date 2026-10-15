import { expect, test } from 'claude-code/testing'

import { MAX_ENTRY_CHARS, rowOf } from '../src/core/transcript/entries'
import { bulkOfRow } from '../src/core/transcript/bulk'
import type { Calls } from '../src/core/transcript/bulk'
import { fileToolsOf } from '../src/core/transcript/touches'

const TS = Date.parse('2026-10-09T10:00:00.000Z')
const isFileTool = fileToolsOf('mcp__files')

const row = (fields: Record<string, unknown>): string =>
  JSON.stringify({ sessionId: 's1', cwd: '/work/app', timestamp: '2026-10-09T10:00:00.000Z', uuid: 'u1', ...fields })

const calling = (...blocks: Record<string, unknown>[]): string => row({ type: 'assistant', message: { role: 'assistant', content: blocks } })
const use = (id: string, name: string, input: Record<string, unknown>): Record<string, unknown> => ({ type: 'tool_use', id, name, input })
const answering = (...blocks: Record<string, unknown>[]): string => row({ type: 'user', message: { role: 'user', content: blocks } })
const result = (id: string, content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'tool_result', tool_use_id: id, content, ...extra })

const bulk = (line: string, calls: Calls = new Map()) => bulkOfRow(rowOf(line), calls, isFileTool)

const PAGE = 'The page explains how the connection pool hands out sockets and what happens when it is empty.'

test('a compaction summary is a summary entry, whole', () => {
  const line = row({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'The session fixed the parser and then wrote the index.' } })
  expect(bulk(line)).toEqual([{ kind: 'summary', text: 'The session fixed the parser and then wrote the index.', ts: TS, session: 's1', project: '/work/app', key: 'u1:s0' }])
})

test('a summary kept as text blocks is joined', () => {
  const line = row({ type: 'user', isCompactSummary: true, message: { role: 'user', content: [{ type: 'text', text: 'First part.' }, { type: 'text', text: 'Second part.' }] } })
  expect(bulk(line).map(e => e.text)).toEqual(['First part.\nSecond part.'])
})

test('a call to a tool that is not Bash and does not edit a file is a call entry with its input', () => {
  const entries = bulk(calling(use('c1', 'mcp__searxng__web_read', { url: 'https://example.com/pool', maxLength: 3000 })))
  expect(entries).toEqual([{ kind: 'call', text: 'mcp__searxng__web_read\nurl: https://example.com/pool\nmaxLength: 3000', ts: TS, session: 's1', project: '/work/app', key: 'u1:c0' }])
})

test('a question Claude asked and the answer picked are left to the prompt entry that holds them', () => {
  const calls: Calls = new Map()
  expect(bulk(calling(use('q1', 'AskUserQuestion', { questions: [{ question: 'Which store should the vectors go in?', options: [] }] })), calls)).toEqual([])
  expect(bulk(answering(result('q1', 'User has answered your questions: "Which store should the vectors go in?"="SQLite"')), calls)).toEqual([])
})

test('a call is forgotten once its result is read, so only calls still waiting are carried on', () => {
  const calls: Calls = new Map()
  bulk(calling(use('c1', 'mcp__searxng__web_read', { url: 'https://example.com/pool' }), use('c2', 'Grep', { pattern: 'pool' })), calls)
  bulk(answering(result('c1', PAGE)), calls)
  expect([...calls.keys()]).toEqual(['c2'])
})

test('a Bash call and a call that edits a file are left to the entries they already have', () => {
  expect(bulk(calling(use('c1', 'Bash', { command: 'bun test' })))).toEqual([])
  expect(bulk(calling(use('c2', 'Edit', { file_path: '/work/app/a.ts', old_string: 'a', new_string: 'b' })))).toEqual([])
  expect(bulk(calling(use('c3', 'mcp__files__batch_edit', { path: '/work/app/a.ts', edits: [['a', 'b']] })))).toEqual([])
})

test('a call keeps its key whatever the file-tools setting makes of the calls before it', () => {
  const line = calling(use('c1', 'mcp__files__batch_edit', { path: '/work/app/a.ts', edits: [['a', 'b']] }), use('c2', 'Grep', { pattern: 'pool' }))
  const grepKey = (setting: string) => bulkOfRow(rowOf(line), new Map(), fileToolsOf(setting)).find(e => e.text.startsWith('Grep'))?.key
  expect(grepKey('mcp__files')).toBe(grepKey(''))
})

test('a call that only reads a file is a call entry', () => {
  expect(bulk(calling(use('c1', 'Read', { file_path: '/work/app/a.ts' }))).map(e => e.text)).toEqual(['Read\nfile_path: /work/app/a.ts'])
})

test('a call that is nested or long is flattened, kept whole up to the size of an entry, and a secret is redacted', () => {
  const key = `sk-ant-${'a1'.repeat(20)}`
  const [entry] = bulk(calling(use('c1', 'Agent', { prompt: `Use ${key} to read the docs`, options: { deep: true } })))
  expect(entry?.text).toBe('Agent\nprompt: Use [redacted:anthropic-key] to read the docs\noptions: {"deep":true}')
  const long = bulk(calling(use('c2', 'Agent', { prompt: 'word '.repeat(2000) })))
  expect(long.length).toBeGreaterThan(1)
  expect(long.every(e => e.text.length <= MAX_ENTRY_CHARS)).toBe(true)
  expect(long.map(e => e.key)).toEqual(long.map((_, i) => (i === 0 ? 'u1:c0' : `u1:c0.${i}`)))
})

test('a successful result is a result entry, headed by the call that made it', () => {
  const calls: Calls = new Map()
  bulk(calling(use('c1', 'mcp__searxng__web_read', { url: 'https://example.com/pool' })), calls)
  expect(bulk(answering(result('c1', PAGE)), calls)).toEqual([
    { kind: 'result', text: `mcp__searxng__web_read https://example.com/pool\n${PAGE}`, ts: TS, session: 's1', project: '/work/app', key: 'u1:r0' },
  ])
})

test('the output of a command and the text blocks of a result are read', () => {
  const calls: Calls = new Map()
  bulk(calling(use('c1', 'Bash', { command: 'ls src' })), calls)
  const text = 'a.ts\nb.ts\nc.ts\nthe three files of the module'
  expect(bulk(answering(result('c1', [{ type: 'text', text }, { type: 'image', source: { data: 'AAAA' } }])), calls).map(e => e.text)).toEqual([`Bash ls src\n${text}`])
})

test('a result that failed, one that is short, and the answer to a file edit are not result entries', () => {
  const calls: Calls = new Map()
  bulk(calling(use('c1', 'Edit', { file_path: '/work/app/a.ts', old_string: 'a', new_string: 'b' }), use('c2', 'Read', { file_path: '/work/app/a.ts' })), calls)
  expect(bulk(answering(result('c1', 'The file /work/app/a.ts has been updated successfully.')), calls)).toEqual([])
  expect(bulk(answering(result('c2', PAGE, { is_error: true })), calls)).toEqual([])
  expect(bulk(answering(result('c2', 'ok')), calls)).toEqual([])
})

test('a result whose call was not seen is still a result entry', () => {
  expect(bulk(answering(result('gone', PAGE))).map(e => e.text)).toEqual([PAGE])
})

test('a long result is cut to a few entries, and a secret in it is redacted', () => {
  const key = `ghp_${'Ab1'.repeat(14)}`
  const entries = bulk(answering(result('c1', `token ${key}\n${'line of output\n'.repeat(5000)}`)))
  expect(entries.length).toBeGreaterThan(1)
  expect(entries.length).toBeLessThanOrEqual(4)
  expect(entries.every(e => e.text.length <= MAX_ENTRY_CHARS)).toBe(true)
  expect(entries.map(e => e.text).join('')).not.toContain(key)
})

test('rows of a sub-agent keep their owner, and rows of a headless run or a meta message give nothing', () => {
  const agent = row({ type: 'assistant', isSidechain: true, agentId: 'agent1', message: { role: 'assistant', content: [use('c1', 'Grep', { pattern: 'pool' })] } })
  expect(bulk(agent)[0]).toMatchObject({ kind: 'call', session: 'agent1', parent: 's1' })
  expect(bulk(calling(use('c1', 'Grep', { pattern: 'pool' })).replace('"uuid"', '"entrypoint":"sdk-cli","uuid"'))).toEqual([])
  expect(bulk(row({ type: 'user', isMeta: true, message: { role: 'user', content: [result('c1', PAGE)] } }))).toEqual([])
})
