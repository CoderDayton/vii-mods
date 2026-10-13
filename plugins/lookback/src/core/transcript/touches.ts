import { redact } from '../text/redact'
import { MAX_ENTRY_CHARS, isHeadless, ownerOf, rowOf } from './entries'
import type { Entry, Row } from './entries'

export type TouchAction = 'read' | 'edit'

// One file a tool call named, and whether the call changed it.
export type Touch = {
  path: string
  action: TouchAction
  tool: string
  ts: number
  session: string
  parent?: string
  project: string
}

export type FileTools = (tool: string) => boolean

const BUILT_IN = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Which tools name files. The built-in file tools always do. The setting adds MCP tools: each item is a
// whole tool name (`mcp__server__edit`) or a server (`mcp__server`, every tool of it), split by commas or
// line breaks.
export const fileToolsOf = (setting: string): FileTools => {
  const named = new Set(
    setting
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(s => s !== ''),
  )
  return tool => BUILT_IN.has(tool) || named.has(tool) || (tool.startsWith('mcp__') && named.has(tool.split('__').slice(0, 2).join('__')))
}

const CHANGES = /edit|write|append|delete|create|rename|move|patch/i

// The name of the tool without its server: `mcp__server__batch_edit` is `batch_edit`.
const shortName = (tool: string): string => (tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') : tool)

const PATH_KEYS = ['file_path', 'path', 'notebook_path'] as const

// A list that a tool takes as JSON text: its items, or none when the text is not a JSON list.
const listOf = (list: unknown): unknown[] => {
  if (Array.isArray(list)) return list
  if (typeof list !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(list)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const pathsIn = (input: unknown): string[] => {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const found: unknown[] = PATH_KEYS.map(k => record[k])
  const many = record.paths
  const listed = listOf(many)
  if (listed.length > 0) found.push(...listed)
  else if (typeof many === 'string') found.push(...many.split(','))
  const paths = found.flatMap(p => (typeof p === 'string' ? [p.trim()] : [])).filter(p => p !== '' && !/[\n\r]/.test(p))
  return [...new Set(paths)]
}

type Block = { type?: unknown; name?: unknown; input?: unknown }

type FileCall = { tool: string; action: TouchAction; paths: string[]; input: unknown }

export const fileCallOf = (tool: string, input: unknown, isFileTool: FileTools): { action: TouchAction; paths: string[] } | null =>
  isFileTool(tool) ? { action: CHANGES.test(shortName(tool)) ? 'edit' : 'read', paths: pathsIn(input) } : null

type Base = { session: string; parent?: string; project: string; ts: number }

const fileCallsOf = (row: Row | null, isFileTool: FileTools): { base: Base; calls: FileCall[] } | null => {
  if (row === null || row.type !== 'assistant' || isHeadless(row)) return null
  const owner = ownerOf(row)
  const content = row.message?.content
  if (owner === null || !Array.isArray(content)) return null
  const ts = Date.parse(typeof row.timestamp === 'string' ? row.timestamp : '')
  const base = { ...owner, project: typeof row.cwd === 'string' ? row.cwd : '', ts: Number.isNaN(ts) ? 0 : ts }
  const calls: FileCall[] = []
  for (const block of content as Block[]) {
    const call = block.type === 'tool_use' && typeof block.name === 'string' ? fileCallOf(block.name, block.input, isFileTool) : null
    if (call !== null) calls.push({ ...call, tool: block.name as string, input: block.input })
  }
  return { base, calls }
}

export const touchesOfRow = (row: Row | null, isFileTool: FileTools): Touch[] => {
  const found = fileCallsOf(row, isFileTool)
  if (found === null) return []
  return found.calls.flatMap(call => call.paths.map(path => ({ path, action: call.action, tool: call.tool, ...found.base })))
}

type Change = { old: string; new: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const changeOf = (item: unknown): Change | null => {
  if (Array.isArray(item)) return { old: str(item[0]), new: str(item[1]) }
  if (typeof item !== 'object' || item === null) return null
  const o = item as Record<string, unknown>
  return { old: str(o.old_string ?? o.old), new: str(o.new_string ?? o.new) }
}

const changesIn = (input: unknown): Change[] => {
  if (typeof input !== 'object' || input === null) return []
  const o = input as Record<string, unknown>
  const single = { old: str(o.old_string), new: str(o.new_string ?? o.content) }
  const many = listOf(o.edits).flatMap(item => changeOf(item) ?? [])
  return [single, ...many].filter(c => c.old !== '' || c.new !== '')
}

const SIDE_CHARS = 1800

const sideOf = (mark: string, text: string): string[] => (text === '' ? [] : [`${mark} ${text.slice(0, SIDE_CHARS)}`])

// The changes the tool calls of one row made to files, each as an entry of kind `edit`: the path on the
// first line, then the text replaced and the text written. A call that names several files is left out.
export const editsOfRow = (row: Row | null, isFileTool: FileTools): Entry[] => {
  const found = fileCallsOf(row, isFileTool)
  if (found === null) return []
  const uuid = typeof row?.uuid === 'string' ? row.uuid : ''
  return found.calls
    .filter(call => call.action === 'edit' && call.paths.length === 1)
    .flatMap(call =>
      changesIn(call.input).map(change => {
        const text = [call.paths[0], ...sideOf('-', redact(change.old)), ...sideOf('+', redact(change.new))].join('\n')
        return { kind: 'edit' as const, text: text.slice(0, MAX_ENTRY_CHARS), ...found.base }
      }),
    )
    .map((edit, i) => (uuid === '' ? edit : { ...edit, key: `${uuid}:e${i}` }))
}

// The files the tool calls of one transcript line name.
export const touchesOf = (line: string, isFileTool: FileTools): Touch[] => touchesOfRow(rowOf(line), isFileTool)
