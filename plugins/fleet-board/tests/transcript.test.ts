import { expect, test } from 'claude-code/testing'

import { replyAfter, TAIL_ARGV } from '../src/transcript'

const row = (type: string, at: number, content: unknown[]) =>
  JSON.stringify({ type, timestamp: new Date(at).toISOString(), message: { content } })

const TEXT = (text: string) => ({ type: 'text', text })

test('the tail command reads the end of the session transcript under the config folder', () => {
  const argv = TAIL_ARGV('/p/quorum', 'q1')
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv[2]).toContain("tr -c 'A-Za-z0-9' '-'")
  expect(argv[2]).toContain('CLAUDE_CONFIG_DIR')
  expect(argv.slice(3)).toEqual(['fleet-board-transcript', '/p/quorum', '1048576', 'q1'])
})

test('a reply is the first assistant text written at or after the briefing', () => {
  const jsonl = [row('user', 100, [TEXT('briefing')]), row('assistant', 200, [TEXT('ready')]), row('assistant', 300, [TEXT('more')])].join('\n')
  expect(replyAfter(jsonl, 100)).toBe(200)
})

test('earlier replies, tool calls and the employee own rows are not replies', () => {
  const jsonl = [
    row('assistant', 50, [TEXT('before the briefing')]),
    row('user', 100, [TEXT('briefing')]),
    row('assistant', 150, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    row('assistant', 400, [TEXT('ready')]),
  ].join('\n')
  expect(replyAfter(jsonl, 100)).toBe(400)
})

test('a partial first line and junk are skipped, and no reply is null', () => {
  const jsonl = ['ssistant","timestamp":"x', 'not json', row('user', 100, [TEXT('briefing')])].join('\n')
  expect(replyAfter(jsonl, 0)).toBeNull()
  expect(replyAfter('', 0)).toBeNull()
})
