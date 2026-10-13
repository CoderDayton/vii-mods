import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listTranscripts, newLines, sessionOf, sessionTranscripts } from '../../src/runtime/transcript/scan'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lookback-scan-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const collect = async (path: string, from: number, size: number, chunkBytes?: number) => {
  const out: { lines: string[]; end: number }[] = []
  for await (const batch of newLines(path, from, size, chunkBytes)) out.push(batch)
  return out
}

test('only the session files directly in a project folder are listed, largest folder last', async () => {
  mkdirSync(join(root, 'proj-a', 'subagents'), { recursive: true })
  mkdirSync(join(root, 'proj-b'), { recursive: true })
  writeFileSync(join(root, 'proj-a', 's1.jsonl'), '{"a":1}\n')
  writeFileSync(join(root, 'proj-a', 'subagents', 'agent.jsonl'), '{"b":1}\n')
  writeFileSync(join(root, 'proj-a', 'notes.txt'), 'x')
  writeFileSync(join(root, 'proj-b', 's2.jsonl'), '{"c":1}\n{"d":2}\n')
  writeFileSync(join(root, 'stray.jsonl'), '{}\n')

  const files = await listTranscripts(root)
  expect(files.map(f => f.path.slice(root.length + 1)).sort()).toEqual(['proj-a/s1.jsonl', 'proj-b/s2.jsonl'])
  expect(files.find(f => f.path.endsWith('s2.jsonl'))?.size).toBe(16)
})

test('a root that does not exist lists nothing', async () => {
  expect(await listTranscripts(join(root, 'absent'))).toEqual([])
})

test('the session of a file is its name without the extension', () => {
  expect(sessionOf('/x/proj/d18dbf28-1111.jsonl')).toBe('d18dbf28-1111')
})

test('the transcripts of one session are its own file and those of its sub-agents', async () => {
  mkdirSync(join(root, 'proj-a', 's1', 'subagents'), { recursive: true })
  mkdirSync(join(root, 'proj-b'), { recursive: true })
  writeFileSync(join(root, 'proj-a', 's1.jsonl'), '{}\n')
  writeFileSync(join(root, 'proj-a', 's1', 'subagents', 'agent-1.jsonl'), '{}\n')
  writeFileSync(join(root, 'proj-a', 's2.jsonl'), '{}\n')
  writeFileSync(join(root, 'proj-b', 's3.jsonl'), '{}\n')

  const files = await sessionTranscripts(root, 's1')
  expect(files.map(f => f.path.slice(root.length + 1))).toEqual(['proj-a/s1.jsonl', 'proj-a/s1/subagents/agent-1.jsonl'])
  expect(files[0]?.size).toBe(3)
  expect(await sessionTranscripts(root, 'absent')).toEqual([])
  expect(await sessionTranscripts(join(root, 'nowhere'), 's1')).toEqual([])
})


test('whole lines are read and the end of each batch is a byte offset after a newline', async () => {
  const path = join(root, 's.jsonl')
  writeFileSync(path, 'one\ntwo\nthree\n')
  const batches = await collect(path, 0, 14)
  expect(batches).toEqual([{ lines: ['one', 'two', 'three'], end: 14 }])
})

test('a line still being written is left for the next read', async () => {
  const path = join(root, 's.jsonl')
  writeFileSync(path, 'one\ntwo\nthr')
  const batches = await collect(path, 0, 11)
  expect(batches).toEqual([{ lines: ['one', 'two'], end: 8 }])
  writeFileSync(path, 'one\ntwo\nthree\n')
  expect(await collect(path, 8, 14)).toEqual([{ lines: ['three'], end: 14 }])
})

test('a read resumes at an offset', async () => {
  const path = join(root, 's.jsonl')
  writeFileSync(path, 'one\ntwo\nthree\n')
  expect(await collect(path, 4, 14)).toEqual([{ lines: ['two', 'three'], end: 14 }])
})

test('a file read in small chunks gives every line once, multi-byte text whole', async () => {
  const path = join(root, 's.jsonl')
  const lines = ['héllo wörld', '日本語のテキスト', 'plain', 'emoji 🙂 here']
  const text = `${lines.join('\n')}\n`
  writeFileSync(path, text)
  const size = Buffer.byteLength(text)
  const batches = await collect(path, 0, size, 16)
  expect(batches.flatMap(b => b.lines)).toEqual(lines)
  expect(batches.at(-1)?.end).toBe(size)
})

test('a line longer than a chunk is read whole', async () => {
  const path = join(root, 's.jsonl')
  const long = 'x'.repeat(100)
  writeFileSync(path, `${long}\nshort\n`)
  const batches = await collect(path, 0, 107, 16)
  expect(batches.flatMap(b => b.lines)).toEqual([long, 'short'])
})

test('Windows line ends are trimmed and empty lines are dropped', async () => {
  const path = join(root, 's.jsonl')
  writeFileSync(path, 'one\r\n\r\ntwo\r\n')
  expect((await collect(path, 0, 12)).flatMap(b => b.lines)).toEqual(['one', 'two'])
})
