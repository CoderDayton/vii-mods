import type { FileUse } from '../types'
import { SHORT_ID, dateOf, fitBlocks, headOf, snippetOf } from './format'

// What one session did to a file, with what the user had asked for before it.
export type Blame = FileUse & { asked: string | null }

const ASKED_WIDTH = 200

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const countsOf = (use: { edits: number; reads: number }): string => [use.edits > 0 ? plural(use.edits, 'edit') : '', use.reads > 0 ? plural(use.reads, 'read') : ''].filter(Boolean).join(', ')

const render = (path: string, rows: readonly Blame[]): string =>
  [
    path,
    ...rows.flatMap(b => [`  ${headOf({ ts: b.first, project: b.project, session: b.session, parent: b.parent })}  ${countsOf(b)}`, ...(b.asked === null ? [] : [`    asked   ${snippetOf(b.asked, [], ASKED_WIDTH)}`])]),
  ].join('\n')

// The sessions that touched each file, one block for each path, cut to `maxChars`.
export const formatBlame = (rows: readonly Blame[], asked: string, options: { maxChars: number }): string => {
  if (rows.length === 0) return `No session on record touched a file that ends with "${asked}".`
  const byPath = new Map<string, Blame[]>()
  for (const row of rows) byPath.set(row.path, [...(byPath.get(row.path) ?? []), row])
  const blocks = [...byPath].map(([path, uses]) => render(path, uses))
  const kept = fitBlocks(blocks, options.maxChars)
  const left = blocks.length - kept.length
  return left === 0 ? kept.join('\n\n') : `${kept.join('\n\n')}\n\n… ${plural(left, 'more file')}; give more of the path`
}

const NOTE_ASKED_WIDTH = 90

// A few lines on what earlier sessions did to one file, for the moment a session first touches it. Empty
// when fewer than `min` sessions changed it.
export const formatFileNote = (rows: readonly Blame[], options: { min: number; shown: number }): string => {
  if (rows.length === 0 || rows.length < options.min) return ''
  const lines = rows.slice(0, options.shown).map(b => {
    const asked = b.asked === null ? '' : snippetOf(b.asked, [], NOTE_ASKED_WIDTH)
    return `  ${dateOf(b.first)}  ${b.session.slice(0, SHORT_ID)}${asked === '' ? '' : `  ${asked}`}`
  })
  return [`Changed in ${plural(rows.length, 'earlier session')}; the latest:`, ...lines].join('\n')
}

// The files a session touched, one per line under the session's own line.
export const formatFiles = (head: string, uses: readonly FileUse[]): string => {
  if (uses.length === 0) return `${head}\n  No file on record for this session.`
  const width = Math.max(...uses.map(u => countsOf(u).length))
  return [head, ...uses.map(u => `  ${countsOf(u).padEnd(width)}  ${u.path}`)].join('\n')
}
