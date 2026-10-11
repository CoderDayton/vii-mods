import { isCommandRow, stripInjected } from './strip'

export type EntryKind = 'user' | 'assistant' | 'error' | 'cmd'

// One searchable passage of a session.
export type Entry = {
  kind: EntryKind
  text: string
  ts: number
  session: string
  project: string
}

export const MAX_ENTRY_CHARS = 4000

type Block = { type?: unknown; text?: unknown; name?: unknown; input?: unknown; content?: unknown; is_error?: unknown }

type Row = {
  type?: unknown
  sessionId?: unknown
  cwd?: unknown
  timestamp?: unknown
  isMeta?: unknown
  isSidechain?: unknown
  message?: { content?: unknown }
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

// The text of a tool result, which is a string or a list of text blocks.
const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[])
    .map(b => asString(b.text))
    .filter(t => t !== '')
    .join('\n')
}

const parse = (line: string): Row | null => {
  try {
    const row: unknown = JSON.parse(line)
    return typeof row === 'object' && row !== null ? (row as Row) : null
  } catch {
    return null
  }
}

// The searchable passages of one transcript line: what the user typed, what Claude said, the shell commands it
// ran, and the tool results that failed. Everything else in a transcript is bulk and is left out.
export const entriesOf = (line: string): Entry[] => {
  const row = parse(line)
  if (row === null || (row.type !== 'user' && row.type !== 'assistant')) return []
  if (row.isMeta === true || row.isSidechain === true) return []
  const session = asString(row.sessionId)
  if (session === '') return []

  const ts = Date.parse(asString(row.timestamp))
  const base = { session, project: asString(row.cwd), ts: Number.isNaN(ts) ? 0 : ts }
  const out: Entry[] = []
  const push = (kind: EntryKind, raw: string): void => {
    const text = raw.trim().slice(0, MAX_ENTRY_CHARS)
    if (text !== '') out.push({ kind, text, ...base })
  }
  const prose = (kind: EntryKind, raw: string): void => {
    if (!isCommandRow(raw)) push(kind, stripInjected(raw))
  }

  const content = row.message?.content
  if (typeof content === 'string') {
    if (row.type === 'user') prose('user', content)
    return out
  }
  if (!Array.isArray(content)) return out

  for (const block of content as Block[]) {
    if (block.type === 'text' && row.type === 'user') prose('user', asString(block.text))
    else if (block.type === 'text') prose('assistant', asString(block.text))
    else if (block.type === 'tool_use' && block.name === 'Bash') push('cmd', asString((block.input as { command?: unknown } | null)?.command))
    else if (block.type === 'tool_result' && block.is_error === true) push('error', resultText(block.content))
  }
  return out
}
