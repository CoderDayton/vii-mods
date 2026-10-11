import type { Entry, EntryKind } from './transcript/entries'

export type { Entry, EntryKind }

export type StoredEntry = Entry & { id: number }

export type Filter = {
  // A substring of the session's working directory, matched without regard to case.
  project?: string
  kinds?: readonly EntryKind[]
  // Epoch milliseconds: entries from this time on.
  since?: number
  // A session whose entries never match, usually the one asking.
  excludeSession?: string
}

export type Ranked = { id: number; score: number }

export type ChunkVector = { entry: number; seq: number; vector: readonly number[] }

export type StoreStats = {
  entries: number
  sessions: number
  chunks: number
  byKind: Partial<Record<EntryKind, number>>
  model: string | null
  dimension: number | null
}

// Kinds that carry prose worth a vector. Shell commands match by keyword only.
export const EMBEDDED_KINDS: readonly EntryKind[] = ['user', 'assistant', 'error']

// A passage shorter than this carries no meaning a vector could find ("yes", "ok, go").
export const MIN_EMBEDDED_CHARS = 20
