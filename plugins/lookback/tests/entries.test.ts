import { expect, test } from 'claude-code/testing'

import { MAX_ENTRY_CHARS, entriesOf, titleOf } from '../src/core/transcript/entries'

const row = (fields: Record<string, unknown>): string =>
  JSON.stringify({ sessionId: 's1', cwd: '/work/app', timestamp: '2026-10-09T10:00:00.000Z', ...fields })

const user = (content: unknown, extra: Record<string, unknown> = {}): string =>
  row({ type: 'user', message: { role: 'user', content }, ...extra })

const assistant = (content: unknown[]): string => row({ type: 'assistant', message: { role: 'assistant', content } })

test('a typed prompt is a user entry with its session, project and time', () => {
  expect(entriesOf(user('Why does the build fail?'))).toEqual([
    { kind: 'user', text: 'Why does the build fail?', ts: Date.parse('2026-10-09T10:00:00.000Z'), session: 's1', project: '/work/app' },
  ])
})

test('text blocks of an assistant message are assistant entries, and thinking that can be read is its own kind', () => {
  const line = assistant([
    { type: 'thinking', thinking: 'The lockfile may be stale; check its date first.', signature: 'abc' },
    { type: 'thinking', thinking: '', signature: 'only a signature' },
    { type: 'text', text: 'The lockfile was stale.' },
  ])
  expect(entriesOf(line).map(e => [e.kind, e.text])).toEqual([
    ['thinking', 'The lockfile may be stale; check its date first.'],
    ['assistant', 'The lockfile was stale.'],
  ])
})

test('a row of a sub-agent belongs to the agent, with the session that started it as its parent', () => {
  const line = row({ type: 'assistant', isSidechain: true, agentId: 'af566143dcbb5ac3d', message: { role: 'assistant', content: [{ type: 'text', text: 'Found three callers.' }] } })
  expect(entriesOf(line)).toEqual([
    { kind: 'assistant', text: 'Found three callers.', ts: Date.parse('2026-10-09T10:00:00.000Z'), session: 'af566143dcbb5ac3d', parent: 's1', project: '/work/app' },
  ])
})

test('a Bash call is a command entry, other tool calls are not read', () => {
  const line = assistant([
    { type: 'tool_use', name: 'Bash', input: { command: 'bun test', description: 'run tests' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/work/app/a.ts' } },
  ])
  expect(entriesOf(line).map(e => [e.kind, e.text])).toEqual([['cmd', 'bun test']])
})

test('only a failed tool result is read, as an error entry', () => {
  const ok = user([{ type: 'tool_result', tool_use_id: 't1', content: 'fine', is_error: false }])
  const bad = user([{ type: 'tool_result', tool_use_id: 't2', content: 'ENOENT: no such file', is_error: true }])
  expect(entriesOf(ok)).toEqual([])
  expect(entriesOf(bad).map(e => [e.kind, e.text])).toEqual([['error', 'ENOENT: no such file']])
})

test('a failed result whose content is a list of text blocks is joined', () => {
  const bad = user([{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }])
  expect(entriesOf(bad).map(e => e.text)).toEqual(['one\ntwo'])
})

test('blocks the harness injects are cut out of a prompt, and a prompt of nothing else is dropped', () => {
  const mixed = user('<system-reminder>be brief</system-reminder>Fix the parser.<deja-recall>old stuff</deja-recall>')
  expect(entriesOf(mixed).map(e => e.text)).toEqual(['Fix the parser.'])
  expect(entriesOf(user('<system-reminder>only this</system-reminder>'))).toEqual([])
  expect(entriesOf(user('<local-command-stdout>Reloaded</local-command-stdout>'))).toEqual([])
})

test('slash command rows, meta rows and sidechain rows that name no agent are skipped', () => {
  expect(entriesOf(user('<command-name>/clear</command-name>'))).toEqual([])
  expect(entriesOf(user('caveat text', { isMeta: true }))).toEqual([])
  expect(entriesOf(user('from a subagent', { isSidechain: true }))).toEqual([])
})

test('a marker the harness writes when a turn is stopped is not something the user said', () => {
  expect(entriesOf(user('[Request interrupted by user]'))).toEqual([])
  expect(entriesOf(user([{ type: 'text', text: '[Request interrupted by user for tool use]' }]))).toEqual([])
  expect(entriesOf(user('[Request interrupted by user] is what the log showed'))).toHaveLength(1)
})

test('the summary the harness writes when a session is compacted is not something the user said', () => {
  expect(entriesOf(user('This session is being continued from a previous conversation.', { isCompactSummary: true }))).toEqual([])
})

test('other row types, bad JSON and rows with no session are skipped', () => {
  expect(entriesOf(row({ type: 'system', content: 'x' }))).toEqual([])
  expect(entriesOf('{"type":"user"')).toEqual([])
  expect(entriesOf('')).toEqual([])
  expect(entriesOf(JSON.stringify({ type: 'user', message: { content: 'no session' } }))).toEqual([])
})

test('a long text becomes several entries, so its end can be found too', () => {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`)
  const entries = entriesOf(user(`${paragraphs.join('\n\n')}\n\nThe last line names zebra.`))
  expect(entries.length).toBe(3)
  expect(entries.every(e => e.kind === 'user' && e.text.length <= MAX_ENTRY_CHARS)).toBe(true)
  expect(entries[0]?.text.startsWith('Paragraph 0')).toBe(true)
  expect(entries.at(-1)?.text.endsWith('The last line names zebra.')).toBe(true)
})

test('a text with no break in it is still held to the entry limit, and a huge one to four entries', () => {
  const entries = entriesOf(user('x'.repeat(40_000)))
  expect(entries.map(e => e.text.length)).toEqual([4000, 4000, 4000, 4000])
})

test('an answer the user picked from a question is a user entry with the question', () => {
  const line = user([{ type: 'tool_result', tool_use_id: 't1', content: 'Your questions have been answered.' }], {
    toolUseResult: { questions: [], answers: { 'Which store should the mod read?': 'Claude Code only', 'Keep the cache?': 'No' } },
  })
  expect(entriesOf(line).map(e => [e.kind, e.text])).toEqual([
    ['user', 'Asked: Which store should the mod read?\nChose: Claude Code only'],
    ['user', 'Asked: Keep the cache?\nChose: No'],
  ])
})

test('each entry of a row that has an id carries a key made from it, so a copied row is stored once', () => {
  const line = row({ type: 'assistant', uuid: 'u1', message: { content: [{ type: 'text', text: 'One.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })
  expect(entriesOf(line).map(e => e.key)).toEqual(['u1:0', 'u1:1'])
  expect(entriesOf(user('No id here.'))[0]?.key).toBeUndefined()
})

test('a title row names its session, and a title the user gave is marked', () => {
  expect(titleOf({ type: 'ai-title', aiTitle: ' Fix the build ', sessionId: 's1' })).toEqual({ session: 's1', title: 'Fix the build', isCustom: false })
  expect(titleOf({ type: 'custom-title', customTitle: 'My name for it', sessionId: 's1' })).toEqual({ session: 's1', title: 'My name for it', isCustom: true })
  expect(titleOf({ type: 'ai-title', aiTitle: '', sessionId: 's1' })).toBeNull()
  expect(titleOf({ type: 'user', sessionId: 's1' })).toBeNull()
})
