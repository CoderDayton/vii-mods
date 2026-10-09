import { expect, test } from 'claude-code/testing'

import { createTranscriptReader, isQuestion, lineOf, READ_ARGV, replyAfter, replyOf, SIZE_ARGV, TAIL_BYTES, transcriptSaid, transcriptTexts } from '../src/transcript'

const row = (type: string, at: number, content: unknown[]) =>
  JSON.stringify({ type, timestamp: new Date(at).toISOString(), message: { content } })

const TEXT = (text: string) => ({ type: 'text', text })

test('the size and read commands look under the config folder, and the read starts at a byte offset', () => {
  const size = SIZE_ARGV('/p/quorum', 'q1')
  expect(size.slice(0, 2)).toEqual(['sh', '-c'])
  expect(size[2]).toContain('CLAUDE_CONFIG_DIR')
  expect(size.slice(3)).toEqual(['fleet-board-size', '/p/quorum', 'q1'])
  const read = READ_ARGV('/p/quorum', 'q1', 42)
  expect(read[2]).toContain('tail -c +')
  expect(read.slice(3)).toEqual(['fleet-board-read', '/p/quorum', 'q1', '42'])
})

test('a second poll reads only the bytes written since the first', async () => {
  const filler = Array.from({ length: 2600 }, (_, i) => row('user', 300 + i, [TEXT('x'.repeat(1000))]))
  const transcript = { text: [row('user', 100, [TEXT('task')]), row('assistant', 200, [TEXT('ready')]), ...filler].join('\n') + '\n', read: 0 }
  const reader = createTranscriptReader(fakeRun(transcript))
  await reader.texts('/p/quorum', 'q1', 100)
  const firstRead = transcript.read
  transcript.text += `${row('assistant', 9000, [TEXT(`done ${ID}`)])}\n`
  transcript.read = 0
  const texts = await reader.texts('/p/quorum', 'q1', 100)
  expect(transcript.read).toBeLessThan(firstRead)
  expect(texts.at(-1)).toEqual({ at: 9000, text: `done ${ID}` })
})

test('a tail that starts inside a multi-byte character still finds a row written after it', async () => {
  const emoji = Array.from({ length: 2000 }, (_, i) => row('user', 300 + i, [TEXT('😀é'.repeat(100))]))
  const transcript = { text: [row('user', 100, [TEXT('task')]), row('assistant', 200, [TEXT('ready')]), ...emoji].join('\n') + '\n', read: 0 }
  const bytes = new TextEncoder().encode(transcript.text)
  // The first tail read starts on a continuation byte, inside a multi-byte character.
  const cut = bytes[bytes.length - TAIL_BYTES]!
  expect(cut >= 0x80 && cut < 0xc0).toBe(true)
  const reader = createTranscriptReader(fakeRun(transcript))
  await reader.texts('/p/quorum', 'q1', 1000)
  transcript.text += `${row('assistant', 9000, [TEXT(`done ${ID}`)])}\n`
  const texts = await reader.texts('/p/quorum', 'q1', 1000)
  expect(texts.at(-1)).toEqual({ at: 9000, text: `done ${ID}` })
})

test('a poll of an unchanged transcript reads no bytes, only its size', async () => {
  const transcript = { text: [row('user', 100, [TEXT('task')]), row('assistant', 200, [TEXT('ready')])].join('\n') + '\n', read: 0 }
  const reader = createTranscriptReader(fakeRun(transcript))
  await reader.texts('/p/quorum', 'q1', 100)
  transcript.read = 0
  await reader.texts('/p/quorum', 'q1', 100)
  expect(transcript.read).toBe(0)
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

test('a reply is the text up to and including the line with the task id', () => {
  const echo = new RegExp(`\\bdone\\s+${ID}\\b`, 'i')
  expect(replyOf(`Built it.\nTests pass.\ndone ${ID}\nNext: the lexer.`, echo)).toBe(`Built it.\nTests pass.\ndone ${ID}`)
})

test('a reply with no line for the task id is the whole text', () => {
  expect(replyOf('Which parser module?')).toBe('Which parser module?')
})

test('a reply longer than 1500 characters keeps its end and starts with an ellipsis', () => {
  const out = replyOf(`${'a'.repeat(2000)}\nQuestion?`)
  expect(out.length).toBe(1500)
  expect(out.startsWith('…')).toBe(true)
  expect(out.endsWith('Question?')).toBe(true)
})

// Answers the size and read commands from an in-memory transcript, and counts the bytes it sends back.
const fakeRun = (transcript: { text: string; read: number }) => async (argv: string[]) => {
  const bytes = new TextEncoder().encode(transcript.text)
  if (argv[3] === 'fleet-board-size') return String(bytes.length)
  if (argv[3] === 'fleet-board-align') {
    const from = Number(argv[6])
    if (from === 0) return '0'
    const newline = bytes.indexOf(10, from - 1)
    return String(newline === -1 ? bytes.length : newline + 1)
  }
  const out = bytes.slice(Number(argv[6]))
  transcript.read += out.length
  return new TextDecoder().decode(out)
}

const tailOf = (jsonl: string) => fakeRun({ text: jsonl, read: 0 })

const ID = 'k3x9qa'
const echoesId = (text: string) => text.includes(ID)

test('a task is done when an assistant text after the task echoes its id', async () => {
  const jsonl = [row('user', 100, [TEXT('task')]), row('assistant', 200, [TEXT(`done ${ID}`)])].join('\n')
  expect(await transcriptSaid(tailOf(jsonl), '/p/quorum', 'q1', 100, echoesId)).toBe(200)
})

test('a text that does not echo the task id is not done', async () => {
  const jsonl = [
    row('user', 100, [TEXT('task')]),
    row('assistant', 150, [TEXT('finished the parser')]),
    row('assistant', 300, [TEXT(`done ${ID}`)]),
  ].join('\n')
  expect(await transcriptSaid(tailOf(jsonl), '/p/quorum', 'q1', 100, echoesId)).toBe(300)
  const silent = row('assistant', 150, [TEXT('finished the parser')])
  expect(await transcriptSaid(tailOf(silent), '/p/quorum', 'q1', 100, echoesId)).toBeNull()
})

test('a line is a question when it has a question mark or starts with question or need', () => {
  expect(isQuestion('Which parser module?')).toBe(true)
  expect(isQuestion('Question: which parser module')).toBe(true)
  expect(isQuestion('Need the parser path')).toBe(true)
  expect(isQuestion('Working on the parser now')).toBe(false)
  expect(isQuestion('Needed the parser path')).toBe(false)
  expect(isQuestion('Those needs are unclear')).toBe(false)
  expect(isQuestion('See https://example.com/a?b=1 for details')).toBe(false)
  expect(isQuestion('Is the parser ready? I will wait')).toBe(true)
})

test('a text shows its first non-empty line, cut to 160 characters', () => {
  expect(lineOf('\n  first line  \nsecond')).toBe('first line')
  expect(lineOf('x'.repeat(200))).toBe(`${'x'.repeat(159)}…`)
})

test('the assistant texts after a time come back in order, from a window that reaches back to it', async () => {
  const jsonl = [
    row('user', 100, [TEXT('task')]),
    row('assistant', 150, [TEXT('working')]),
    row('assistant', 300, [TEXT(`done ${ID}`)]),
    row('user', 400, [TEXT('thanks')]),
  ].join('\n')
  expect(await transcriptTexts(tailOf(jsonl), '/p/quorum', 'q1', 100)).toEqual([
    { at: 150, text: 'working' },
    { at: 300, text: `done ${ID}` },
  ])
})

test('forgetting a task drops its cursor, so the next read starts again from the whole window', async () => {
  const filler = Array.from({ length: 2600 }, (_, i) => row('user', 300 + i, [TEXT('x'.repeat(1000))]))
  const transcript = { text: [row('user', 100, [TEXT('task')]), row('assistant', 200, [TEXT('ready')]), ...filler].join('\n') + '\n', read: 0 }
  const reader = createTranscriptReader(fakeRun(transcript))
  await reader.texts('/p/quorum', 'q1', 100)
  const firstRead = transcript.read
  reader.forget('/p/quorum', 'q1', 100)
  transcript.read = 0
  await reader.texts('/p/quorum', 'q1', 100)
  expect(transcript.read).toBe(firstRead)
})

test('a reply older than the 1 MiB tail is still found', async () => {
  const filler = Array.from({ length: 2600 }, (_, i) => row('user', 300 + i, [TEXT('x'.repeat(1000))]))
  const jsonl = [row('user', 100, [TEXT('briefing')]), row('assistant', 200, [TEXT('ready')]), ...filler].join('\n')
  expect(new TextEncoder().encode(jsonl).length).toBeGreaterThan(1_048_576)
  expect(await transcriptSaid(tailOf(jsonl), '/p/quorum', 'q1', 100, text => text.trim() !== '')).toBe(200)
})
