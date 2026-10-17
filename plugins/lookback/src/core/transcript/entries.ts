import { chunksOf } from '../text/chunk'
import { redact } from '../text/redact'
import { isCommandRow, stripInjected } from './strip'

export const ENTRY_KINDS = ['user', 'assistant', 'thinking', 'error', 'cmd', 'edit', 'summary', 'call', 'result', 'image'] as const

export type EntryKind = (typeof ENTRY_KINDS)[number]

// One searchable passage of a session.
export type Entry = {
  kind: EntryKind
  text: string
  ts: number
  session: string
  // For a sub-agent's entry, the session that started the agent.
  parent?: string
  project: string
  // Names the entry across transcripts: a resumed session copies rows into a new file, and the index keeps
  // one entry per key. Absent for a row with no id.
  key?: string
}

export const MAX_ENTRY_CHARS = 4000
// A text longer than one entry is stored as up to this many, so its end is searchable too.
const MAX_PARTS = 4

type Block = { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; input?: unknown; content?: unknown; is_error?: unknown }

export type Row = {
  type?: unknown
  uuid?: unknown
  aiTitle?: unknown
  customTitle?: unknown
  toolUseResult?: unknown
  sessionId?: unknown
  cwd?: unknown
  timestamp?: unknown
  isMeta?: unknown
  isSidechain?: unknown
  agentId?: unknown
  isCompactSummary?: unknown
  origin?: unknown
  entrypoint?: unknown
  message?: { content?: unknown }
}

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

// A text with its secrets redacted, as the passages of an entry: one, or up to MAX_PARTS when it is longer.
export const passagesOf = (raw: string): string[] => {
  const whole = redact(raw.trim())
  return (whole.length <= MAX_ENTRY_CHARS ? [whole] : chunksOf(whole, { maxChars: MAX_ENTRY_CHARS, maxChunks: MAX_PARTS })).filter(text => text !== '')
}

// The text of a tool result, which is a string or a list of text blocks.
export const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[])
    .map(b => asString(b.text))
    .filter(t => t !== '')
    .join('\n')
}

// Whose row it is. A sub-agent's rows carry the id of the session that started it; the agent's own id names
// its run. Null for a row that names neither.
export const ownerOf = (row: Row): { session: string; parent?: string } | null => {
  const session = asString(row.sessionId)
  if (session === '') return null
  if (row.isSidechain !== true) return { session }
  const agent = asString(row.agentId)
  return agent === '' ? null : { session: agent, parent: session }
}

// How Claude Code marks a run started with `claude -p`: a script or a mod asked, not a person at the prompt.
const HEADLESS = 'sdk-cli'

export const isHeadless = (row: Row): boolean => row.entrypoint === HEADLESS

const PEER_MESSAGE = /<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/

// The text another Claude session sent to this one, or null for any other row. The harness marks such a row
// as its own, yet it is what the session was asked to do: a teammate's task, or a teammate's report.
const peerMessage = (row: Row): string | null => {
  const origin = row.origin as { kind?: unknown } | null | undefined
  const content = row.message?.content
  if (row.type !== 'user' || origin?.kind !== 'peer' || typeof content !== 'string') return null
  return PEER_MESSAGE.exec(content)?.[1] ?? null
}

export type SessionTitle = { session: string; title: string; isCustom: boolean }

// The name a row gives its session: one Claude Code wrote, or one the user typed, which counts for more.
export const titleOf = (row: Row | null): SessionTitle | null => {
  if (row === null || (row.type !== 'ai-title' && row.type !== 'custom-title')) return null
  const isCustom = row.type === 'custom-title'
  const title = redact(asString(isCustom ? row.customTitle : row.aiTitle).trim())
  const session = asString(row.sessionId)
  return title === '' || session === '' ? null : { session, title, isCustom }
}

const answersOf = (row: Row): string[] => {
  const answers = (row.toolUseResult as { answers?: unknown } | null | undefined)?.answers
  if (typeof answers !== 'object' || answers === null) return []
  return Object.entries(answers).map(([question, answer]) => `Asked: ${question}\nChose: ${typeof answer === 'string' ? answer : JSON.stringify(answer)}`)
}

// One transcript line as an object, or null when it is not one.
export const rowOf = (line: string): Row | null => {
  try {
    const row: unknown = JSON.parse(line)
    return typeof row === 'object' && row !== null ? (row as Row) : null
  } catch {
    return null
  }
}

// The searchable passages of one transcript line: what the user typed, what Claude said, the shell commands it
// ran, and the tool results that failed. Everything else in a transcript is bulk and is left out.
export const entriesOf = (line: string): Entry[] => entriesOfRow(rowOf(line))

export const entriesOfRow = (row: Row | null): Entry[] => {
  if (row === null || (row.type !== 'user' && row.type !== 'assistant')) return []
  const sent = peerMessage(row)
  if ((row.isMeta === true && sent === null) || row.isCompactSummary === true || isHeadless(row)) return []
  const owner = ownerOf(row)
  if (owner === null) return []

  const ts = Date.parse(asString(row.timestamp))
  const base = { ...owner, project: asString(row.cwd), ts: Number.isNaN(ts) ? 0 : ts }
  const out: Entry[] = []
  const uuid = asString(row.uuid)
  const push = (kind: EntryKind, raw: string): void => {
    for (const text of passagesOf(raw)) out.push(uuid === '' ? { kind, text, ...base } : { kind, text, ...base, key: `${uuid}:${out.length}` })
  }
  const prose = (kind: EntryKind, raw: string): void => {
    if (!isCommandRow(raw)) push(kind, stripInjected(raw))
  }

  const content = row.message?.content
  if (typeof content === 'string') {
    if (row.type === 'user') prose('user', sent ?? content)
    return out
  }
  if (!Array.isArray(content)) return out

  for (const block of content as Block[]) {
    if (block.type === 'text' && row.type === 'user') prose('user', asString(block.text))
    else if (block.type === 'text') prose('assistant', asString(block.text))
    else if (block.type === 'thinking') push('thinking', asString(block.thinking))
    else if (block.type === 'tool_use' && block.name === 'Bash') push('cmd', asString((block.input as { command?: unknown } | null)?.command))
    else if (block.type === 'tool_result' && block.is_error === true) push('error', resultText(block.content))
  }
  if (row.type === 'user') for (const answer of answersOf(row)) push('user', answer)
  return out
}
