import { NO_FIX } from '../call'
import type { EntryKind } from '../types'
import { fitBlocks, headOf, snippetOf } from './format'

// A past session that hit an error, and what was done right after it.
export type Fix = {
  session: string
  project: string
  ts: number
  error: string
  then: { kind: EntryKind; text: string }[]
}

const GIST_CHARS = 400
const LINE_WIDTH = 220
const NAMES_ERROR = /error|exception|failed|failure|fatal|denied|not found|cannot|can't|no such|panic|ERR!/i
// A line of a stack trace: it says where, not what.
const FRAME = /^(at\s|File\s"|\^+$|\d+\s*\|)/

// The part of a failed command's output that names the failure: its last two lines that name an error, or
// its last two lines when none does. A stack trace repeats in every failure; the error line does not.
export const errorGist = (output: string): string => {
  const lines = output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !FRAME.test(l))
  const naming = lines.filter(l => NAMES_ERROR.test(l))
  return (naming.length > 0 ? naming : lines).slice(-2).join(' ').slice(0, GIST_CHARS)
}

// An error counts as the same one when the words it shares with the one asked about carry this share of the
// weight. Paths and line numbers differ from one run to the next; the name of the error does not.
const MIN_SHARED_WEIGHT = 0.6

// What a word of an error is worth: more the fewer past errors hold it, of `total` on record. "error" is in
// most of them and says little; "TS2345" is in few and names the failure.
export const weightOf = (holding: number, total: number): number => Math.log(1 + total / (1 + holding))

export const sameError = (text: string, weights: ReadonlyMap<string, number>): boolean => {
  const lower = text.toLowerCase()
  let all = 0
  let shared = 0
  for (const [term, weight] of weights) {
    all += weight
    if (lower.includes(term)) shared += weight
  }
  return all > 0 && shared >= all * MIN_SHARED_WEIGHT
}

const LABEL: Record<EntryKind, string> = { cmd: 'then ran', assistant: 'said', user: 'asked', error: 'then hit', thinking: 'thought', edit: 'changed', summary: 'summed up', call: 'called', result: 'returned' }

const render = (fix: Fix, terms: readonly string[]): string =>
  [headOf(fix), `  ${'error'.padEnd(9)} ${snippetOf(fix.error, terms, LINE_WIDTH)}`, ...fix.then.map(e => `  ${LABEL[e.kind].padEnd(9)} ${snippetOf(e.text, [], LINE_WIDTH)}`)].join('\n')

export const formatFixes = (fixes: readonly Fix[], terms: readonly string[], options: { maxChars: number }): string => {
  if (fixes.length === 0) return NO_FIX
  const kept = fitBlocks(
    fixes.map(f => render(f, terms)),
    options.maxChars,
  )
  const left = fixes.length - kept.length
  return left === 0 ? kept.join('\n\n') : `${kept.join('\n\n')}\n\n… ${left} more`
}
