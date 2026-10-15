import { asString, isHeadless, ownerOf, passagesOf, resultText } from './entries'
import type { Entry, EntryKind, Row } from './entries'
import { fileCallOf } from './touches'
import type { FileTools } from './touches'

// `quiet` leaves the call's result out: an edit is answered by an acknowledgement, and the answer to an
// AskUserQuestion is already a prompt entry.
export type Called = { name: string; target: string; quiet: boolean }

const ASK = 'AskUserQuestion'

export type Calls = Map<string, Called>

const MIN_RESULT_CHARS = 40
const TARGET_CHARS = 120
const TARGET_KEYS = ['file_path', 'path', 'url', 'query', 'pattern', 'command', 'description', 'prompt', 'name'] as const

type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown }

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

const valueText = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : (JSON.stringify(value) ?? ''))

const inputText = (input: unknown): string =>
  typeof input === 'object' && input !== null
    ? Object.entries(input)
        .map(([key, value]) => `${key}: ${valueText(value)}`)
        .join('\n')
    : valueText(input)

const targetOf = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const key = TARGET_KEYS.find(k => typeof fields[k] === 'string' && fields[k] !== '')
  return key === undefined ? '' : flat(fields[key] as string).slice(0, TARGET_CHARS)
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[])
          .map(b => (b.type === 'text' ? asString(b.text) : ''))
          .filter(t => t !== '')
          .join('\n')
      : ''

// The passages of one transcript line that the plain entries leave out: the summary a compaction wrote, the
// calls to tools other than Bash and the file tools that edit, and the output of every call that worked. Each
// call is noted in `calls` until its result is read, so that the result can name it.
export const bulkOfRow = (row: Row | null, calls: Calls, isFileTool: FileTools): Entry[] => {
  if (row === null || (row.type !== 'user' && row.type !== 'assistant') || isHeadless(row)) return []
  const owner = ownerOf(row)
  if (owner === null) return []
  const ts = Date.parse(asString(row.timestamp))
  const base = { ...owner, project: asString(row.cwd), ts: Number.isNaN(ts) ? 0 : ts }
  const uuid = asString(row.uuid)
  const out: Entry[] = []
  // Keyed by the block's place in the row, not by how many entries came before it: which calls give an entry
  // depends on the file-tools setting, and a reread under another setting must not reuse a key for other text.
  const push = (kind: EntryKind, mark: string, raw: string): void => {
    passagesOf(raw).forEach((text, part) => out.push(uuid === '' ? { kind, text, ...base } : { kind, text, ...base, key: `${uuid}:${mark}${part === 0 ? '' : `.${part}`}` }))
  }

  const content = row.message?.content
  if (row.isCompactSummary === true) {
    push('summary', 's0', textOf(content))
    return out
  }
  if (row.isMeta === true || !Array.isArray(content)) return out

  for (const [i, block] of (content as Block[]).entries()) {
    if (block.type === 'tool_use') {
      const name = asString(block.name)
      const quiet = name === ASK || fileCallOf(name, block.input, isFileTool)?.action === 'edit'
      calls.set(asString(block.id), { name, target: targetOf(block.input), quiet })
      if (name !== 'Bash' && !quiet) push('call', `c${i}`, `${name}\n${inputText(block.input)}`)
    } else if (block.type === 'tool_result') {
      const id = asString(block.tool_use_id)
      const called = calls.get(id)
      calls.delete(id)
      const text = resultText(block.content).trim()
      if (block.is_error === true || called?.quiet === true || text.length < MIN_RESULT_CHARS) continue
      const head = called === undefined ? '' : `${called.name}${called.target === '' ? '' : ` ${called.target}`}\n`
      push('result', `r${i}`, `${head}${text}`)
    }
  }
  return out
}
