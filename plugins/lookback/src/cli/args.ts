import { durationMs } from '../core/text/duration'
import { ENTRY_KINDS } from '../core/transcript/entries'
import type { EntryKind } from '../core/types'
import { UsageError } from './io'

export const integer = (name: string, text: string | undefined, min: number, max: number, fallback: number): number => {
  if (text === undefined) return fallback
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`)
  return value
}

export const kindsOf = (names: readonly string[] | undefined): EntryKind[] | undefined => {
  if (names === undefined) return undefined
  const bad = names.find(n => !ENTRY_KINDS.includes(n as EntryKind))
  if (bad !== undefined) throw new UsageError(`--kind must be one of ${ENTRY_KINDS.join(', ')}, not "${bad}"`)
  return names as EntryKind[]
}

// The time a `--since` span reaches back to, in epoch milliseconds.
export const sinceOf = (span: string | undefined, now: number): number | undefined => {
  if (span === undefined) return undefined
  const ms = durationMs(span)
  if (ms === null) throw new UsageError(`--since must look like 12h, 30d or 2w, not "${span}"`)
  return now - ms
}

// What follows the command name as one text; a command that needs it says what is missing.
export const textOf = (positionals: readonly string[], missing: string): string => {
  const text = positionals.join(' ').trim()
  if (text === '') throw new UsageError(missing)
  return text
}
