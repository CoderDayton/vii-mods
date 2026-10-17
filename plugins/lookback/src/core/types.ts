import type { Entry, EntryKind } from './transcript/entries'
import type { Touch, TouchAction } from './transcript/touches'

export type { Entry, EntryKind, Touch, TouchAction }

export type StoredEntry = Entry & { id: number }

export type Filter = {
  // A substring of the session's working directory, matched without regard to case.
  project?: string
  kinds?: readonly EntryKind[]
  // Epoch milliseconds: entries from this time on.
  since?: number
  // A session whose entries never match, usually the one asking.
  excludeSession?: string
  // Epoch milliseconds: entries before this time.
  until?: number
  // A session whose entries, and those of its sub-agents, match only when they are older than `ts`.
  sessionBefore?: { session: string; ts: number }
}

export type Ranked = { id: number; score: number }

// One session as the index holds it: when it ran and how many entries it has.
export type SessionSummary = { session: string; parent?: string; project: string; first: number; last: number; entries: number }

// A session a person ran: its title when it has one, the first thing they asked, and the last thing Claude said.
export type RecentSession = { session: string; project: string; last: number; title: string | null; asked: string | null; ended: string | null }

// A shell command and how often it ran; `last` and `project` are those of its latest run.
export type CommandUse = { text: string; runs: number; last: number; project: string }

// A session the user had removed from the index, and when.
export type ForgottenSession = { session: string; project: string; at: number }

// What one session did to one file. `first` is the time of its first edit, or of its first read when it
// made no edit.
// The kinds whose text is something a person or Claude said, and the kinds whose text is code that was run or
// written. A search fetches candidates of each sort apart, so one sort cannot fill every place.
export const PROSE_KINDS: readonly EntryKind[] = ['user', 'assistant', 'thinking', 'error', 'summary', 'image']
export const CODE_KINDS: readonly EntryKind[] = ['cmd', 'edit']
// The calls of other tools and what they returned: bulk that would fill the places of the other kinds.
export const BULK_KINDS: readonly EntryKind[] = ['call', 'result']

export type Turn = { start: number; asked?: string; ended?: string; reply?: string }

export type FileUse = { path: string; session: string; parent?: string; project: string; edits: number; reads: number; first: number; last: number }

// A pasted image saved beside the index as `file`, named by `sha`, the hash of its bytes.
export type KeptPaste = { key: string; sha: string; file: string; session: string; parent?: string; project: string; ts: number }

export type ChunkVector = { entry: number; seq: number; vector: readonly number[] }

export type StoreStats = {
  entries: number
  sessions: number
  // Sub-agent runs, which are not counted as sessions.
  agents: number
  chunks: number
  redacted: number
  // Distinct file paths that tool calls named.
  files: number
  byKind: Partial<Record<EntryKind, number>>
  model: string | null
  dimension: number | null
}


// A passage shorter than this carries no meaning a vector could find ("yes", "ok, go").
export const MIN_EMBEDDED_CHARS = 20
