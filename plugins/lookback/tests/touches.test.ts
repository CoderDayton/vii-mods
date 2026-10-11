import { expect, test } from 'claude-code/testing'

import { rowOf } from '../src/core/transcript/entries'
import { editsOfRow, fileToolsOf, touchesOf } from '../src/core/transcript/touches'

const call = (name: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    cwd: '/work/app',
    timestamp: '2026-10-09T10:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input }] },
    ...extra,
  })

const TS = Date.parse('2026-10-09T10:00:00.000Z')
const none = fileToolsOf('')
const cache = fileToolsOf('mcp__semantic-cache-mcp')

test('a run with no person at the prompt leaves no files and no edits', () => {
  const line = call('Edit', { file_path: '/work/app/a.ts', old_string: 'x', new_string: 'y' }, { entrypoint: 'sdk-cli' })
  expect(touchesOf(line, none)).toEqual([])
  expect(editsOfRow(rowOf(line), none)).toEqual([])
})

test('the built-in file tools are recorded with no setting, as a read or an edit', () => {
  expect(touchesOf(call('Edit', { file_path: '/work/app/a.ts', old_string: 'x', new_string: 'y' }), none)).toEqual([
    { path: '/work/app/a.ts', action: 'edit', tool: 'Edit', ts: TS, session: 's1', project: '/work/app' },
  ])
  expect(touchesOf(call('Read', { file_path: '/work/app/a.ts' }), none).map(t => t.action)).toEqual(['read'])
  expect(touchesOf(call('Write', { file_path: '/work/app/b.ts', content: '' }), none).map(t => t.action)).toEqual(['edit'])
  expect(touchesOf(call('NotebookEdit', { notebook_path: '/work/app/n.ipynb' }), none).map(t => t.path)).toEqual(['/work/app/n.ipynb'])
})

test('an MCP tool is recorded only when the setting names it or its server', () => {
  const edit = call('mcp__semantic-cache-mcp__edit', { path: '/work/app/a.ts', old_string: 'x', new_string: 'y' })
  expect(touchesOf(edit, none)).toEqual([])
  expect(touchesOf(edit, cache).map(t => [t.path, t.action, t.tool])).toEqual([['/work/app/a.ts', 'edit', 'mcp__semantic-cache-mcp__edit']])
  expect(touchesOf(edit, fileToolsOf('mcp__semantic-cache-mcp__edit'))).toHaveLength(1)
  expect(touchesOf(edit, fileToolsOf('mcp__semantic-cache-mcp__read'))).toEqual([])
  expect(touchesOf(edit, fileToolsOf('mcp__semantic-cache'))).toEqual([])
  expect(touchesOf(edit, fileToolsOf(' mcp__other ,\n mcp__semantic-cache-mcp '))).toHaveLength(1)
})

test('a tool is an edit when its name says it changes a file, and a read otherwise', () => {
  const action = (tool: string) => touchesOf(call(`mcp__semantic-cache-mcp__${tool}`, { path: '/a' }), cache)[0]?.action
  expect(['edit', 'batch_edit', 'write', 'delete', 'read', 'grep', 'read_image'].map(action)).toEqual(['edit', 'edit', 'edit', 'edit', 'read', 'read', 'read'])
})

test('several paths in one call are each recorded once, from a list or a comma-separated text', () => {
  expect(touchesOf(call('mcp__semantic-cache-mcp__batch_read', { paths: '/a.ts, /b.ts,/a.ts' }), cache).map(t => t.path)).toEqual(['/a.ts', '/b.ts'])
  expect(touchesOf(call('mcp__semantic-cache-mcp__batch_read', { paths: ['/a.ts', 7, '/c.ts'] }), cache).map(t => t.path)).toEqual(['/a.ts', '/c.ts'])
})

const edits = (name: string, input: Record<string, unknown>, tools = cache) => editsOfRow(rowOf(call(name, input)), tools)

test('an edit is an entry that holds the path, what was replaced and what replaced it', () => {
  expect(edits('mcp__semantic-cache-mcp__edit', { path: '/work/app/a.ts', old_string: 'const limit = 5', new_string: 'const limit = 10', known_hash: 'h' })).toEqual([
    { kind: 'edit', text: '/work/app/a.ts\n- const limit = 5\n+ const limit = 10', ts: TS, session: 's1', project: '/work/app' },
  ])
  expect(edits('Edit', { file_path: '/a.ts', old_string: 'x', new_string: '' }, none).map(e => e.text)).toEqual(['/a.ts\n- x'])
})

test('a written file is an entry with its new text, and each pair of a batch is its own entry', () => {
  expect(edits('mcp__semantic-cache-mcp__write', { path: '/a.ts', content: 'export const a = 1' }).map(e => e.text)).toEqual(['/a.ts\n+ export const a = 1'])
  const pairs = JSON.stringify([
    ['one', 'uno'],
    ['two', 'dos'],
  ])
  expect(edits('mcp__semantic-cache-mcp__batch_edit', { path: '/a.ts', edits: pairs }).map(e => e.text)).toEqual(['/a.ts\n- one\n+ uno', '/a.ts\n- two\n+ dos'])
  const list = [{ old_string: 'a', new_string: 'b' }]
  expect(edits('MultiEdit', { file_path: '/a.ts', edits: list }, none).map(e => e.text)).toEqual(['/a.ts\n- a\n+ b'])
})

test('long sides of an edit are cut, secrets in it are redacted, and a read gives no entry', () => {
  const [long] = edits('Edit', { file_path: '/a.ts', old_string: 'o'.repeat(9000), new_string: 'n'.repeat(9000) }, none)
  expect(long!.text.length).toBeLessThanOrEqual(4000)
  expect(long!.text).toContain('+ nnn')
  const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`
  expect(edits('Edit', { file_path: '/a.ts', old_string: 'x', new_string: `token = "${token}"` }, none)[0]?.text).not.toContain(token)
  expect(edits('Read', { file_path: '/a.ts' }, none)).toEqual([])
  expect(edits('mcp__semantic-cache-mcp__edit', { path: '/a.ts', old_string: 'a', new_string: 'b' }, none)).toEqual([])
  expect(edits('mcp__semantic-cache-mcp__batch_edit', { path: '/a.ts', edits: 'not json' })).toEqual([])
})

test('a call with no path, a path over two lines, and rows that are not tool calls give nothing', () => {
  expect(touchesOf(call('mcp__semantic-cache-mcp__stats', {}), cache)).toEqual([])
  expect(touchesOf(call('Edit', { file_path: '/a\n/b' }), none)).toEqual([])
  expect(touchesOf(call('Bash', { command: 'cat /work/app/a.ts' }), none)).toEqual([])
  expect(touchesOf(call('Edit', { file_path: '/a.ts' }, { isSidechain: true }), none)).toEqual([])
  expect(touchesOf(call('Edit', { file_path: '/a.ts' }, { isSidechain: true, agentId: 'a1' }), none).map(t => [t.session, t.parent])).toEqual([['a1', 's1']])
  expect(touchesOf('{"type":"assistant"', none)).toEqual([])
})

test('several paths passed as the text of a JSON list are each recorded', () => {
  expect(touchesOf(call('mcp__semantic-cache-mcp__batch_read', { paths: '["/a.ts", "/b.ts", "/a.ts"]' }), cache).map(t => t.path)).toEqual(['/a.ts', '/b.ts'])
  expect(touchesOf(call('mcp__semantic-cache-mcp__batch_read', { paths: '[not json, /b.ts' }), cache).map(t => t.path)).toEqual(['[not json', '/b.ts'])
})
