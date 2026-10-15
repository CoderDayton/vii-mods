import { chunksOf } from '../core/text/chunk'
import { bulkOfRow } from '../core/transcript/bulk'
import type { Calls } from '../core/transcript/bulk'
import { entriesOfRow, rowOf, titleOf } from '../core/transcript/entries'
import { editsOfRow, fileToolsOf, touchesOfRow } from '../core/transcript/touches'
import type { FileTools } from '../core/transcript/touches'
import { EmbeddingUnavailableError } from './embedding/embedder'
import type { Embedder } from './embedding/embedder'
import type { Store } from './store/store'
import { listTranscripts, newLines, sessionTranscripts } from './transcript/scan'
import type { TranscriptFile } from './transcript/scan'

export type Progress = {
  phase: 'transcripts' | 'embedding'
  // Bytes read, then entries embedded.
  done: number
  total: number
}

export type IndexOptions = {
  projectsRoot: string
  // MCP tools and servers whose calls name files; see fileToolsOf. Left out, the index keeps the setting it
  // was built under, so a run by hand does not undo what the mod set.
  fileTools?: string
  // Without one the index holds keywords only.
  embedder: Embedder | null
  onProgress?: (progress: Progress) => void
}

export type IndexReport = {
  files: number
  entries: number
  chunks: number
  embeddingError: string | null
}

// Entries embedded between two writes to the index.
const EMBED_ENTRIES = 128

type Job = { file: TranscriptFile; from: number }

// Where reading starts in each transcript: after the last line read, at the top for a new file or one that
// shrank (its offset is past the end), and nowhere for a file whose size has not moved. A file read from the
// top takes the place of what was on record from it.
const jobsFor = (store: Store, files: readonly TranscriptFile[]): Job[] => {
  const jobs: Job[] = []
  for (const file of files) {
    const state = store.fileState(file.path)
    if (state === null || file.size < state.offset) {
      store.dropSource(file.path)
      jobs.push({ file, from: 0 })
    } else if (file.size !== state.size) jobs.push({ file, from: state.offset })
  }
  return jobs
}

// Reads the transcripts that are new or grew since the last run, then embeds the entries that lack a vector.
// Safe to stop at any point and run again.
export const indexAll = async (store: Store, options: IndexOptions): Promise<IndexReport> => {
  const report: IndexReport = { files: 0, entries: 0, chunks: 0, embeddingError: null }
  await readTranscripts(store, options, report)
  if (options.embedder !== null) await embedPending(store, options.embedder, options, report)
  return report
}

// Reads again, for files, edits, calls and results only, the part of each transcript that was read under another
// file-tools setting. The other entries and their vectors are not touched. Calls and results are stored as they
// are read and only their keys held, so a long transcript's tool output is never all in memory at once.
const rereadFileRecords = async (store: Store, files: readonly TranscriptFile[], isFileTool: FileTools): Promise<void> => {
  for (const file of files) {
    const state = store.fileState(file.path)
    if (state === null || state.offset === 0) continue
    const touches = []
    const edits = []
    const keys = new Set<string>()
    const ids = new Set<number>()
    const calls: Calls = new Map()
    for await (const batch of newLines(file.path, 0, state.offset)) {
      const rows = batch.lines.map(rowOf)
      touches.push(...rows.flatMap(row => touchesOfRow(row, isFileTool)))
      edits.push(...rows.flatMap(row => editsOfRow(row, isFileTool)))
      const later = rows.flatMap(row => bulkOfRow(row, calls, isFileTool)).filter(e => e.kind !== 'summary')
      for (const e of later) if (e.key !== undefined) keys.add(e.key)
      for (const id of store.addLater(file.path, later)) ids.add(id)
    }
    store.replaceFileRecords(file.path, touches, edits, { keys, ids })
  }
}

// Reads again the part of each transcript that was read before calls, results and summaries were read, for those
// alone. Every entry has a key, so a run that stopped halfway leaves nothing twice.
const readLater = async (store: Store, files: readonly TranscriptFile[], isFileTool: FileTools): Promise<void> => {
  for (const file of files) {
    const state = store.fileState(file.path)
    if (state === null || state.offset === 0) continue
    const calls: Calls = new Map()
    for await (const batch of newLines(file.path, 0, state.offset)) {
      store.addLater(file.path, batch.lines.map(rowOf).flatMap(row => bulkOfRow(row, calls, isFileTool)))
    }
  }
}

const readTranscripts = async (store: Store, options: IndexOptions, report: IndexReport): Promise<void> => {
  const files = await listTranscripts(options.projectsRoot)
  const jobs = jobsFor(store, files)
  const setting = options.fileTools ?? store.fileTools ?? ''
  const isFileTool = fileToolsOf(setting)
  if (store.fileTools !== setting) {
    await rereadFileRecords(store, files, isFileTool)
    store.fileTools = setting
  }
  if (!store.laterRead) {
    await readLater(store, files, isFileTool)
    store.laterRead = true
  }
  await readJobs(store, jobs, isFileTool, options.onProgress, report)
}

const readJobs = async (store: Store, jobs: readonly Job[], isFileTool: FileTools, onProgress: IndexOptions['onProgress'], report: IndexReport): Promise<void> => {
  const total = jobs.reduce((sum, j) => sum + j.file.size - j.from, 0)
  let done = 0
  for (const { file, from } of jobs) {
    report.files++
    let pos = from
    const calls: Calls = from === 0 ? new Map() : store.openCalls(file.path)
    for await (const batch of newLines(file.path, from, file.size)) {
      const rows = batch.lines.map(rowOf)
      const entries = rows.flatMap(row => [...entriesOfRow(row), ...editsOfRow(row, isFileTool), ...bulkOfRow(row, calls, isFileTool)])
      const touches = rows.flatMap(row => touchesOfRow(row, isFileTool))
      const titles = rows.flatMap(row => titleOf(row) ?? [])
      store.ingest(file.path, entries, { size: file.size, offset: batch.end }, touches, titles, calls)
      report.entries += entries.length
      done += batch.end - pos
      pos = batch.end
      onProgress?.({ phase: 'transcripts', done, total })
    }
  }
}

export type RefreshOptions = {
  projectsRoot: string
  session: string
  embedder: Embedder | null
  // How long new entries may take to embed. The ones left over wait for the next full run.
  embedMs?: number
}

const REFRESH_EMBED_MS = 2500

// Reads the new lines of one session's transcripts, and of its sub-agents', then embeds new entries while
// time is left. It runs while a prompt waits, so vectors of another model stay as they are until a full run.
export const refreshSession = async (store: Store, options: RefreshOptions): Promise<IndexReport> => {
  const report: IndexReport = { files: 0, entries: 0, chunks: 0, embeddingError: null }
  const jobs = jobsFor(store, await sessionTranscripts(options.projectsRoot, options.session))
  await readJobs(store, jobs, fileToolsOf(store.fileTools ?? ''), undefined, report)
  const { embedder } = options
  if (embedder === null || store.vectors?.model !== embedder.model) return report
  const deadline = Date.now() + (options.embedMs ?? REFRESH_EMBED_MS)
  try {
    while (Date.now() < deadline) {
      const batch = store.pending(EMBED_ENTRIES, options.session)
      if (batch.length === 0) break
      report.chunks += await embedBatch(store, embedder, batch)
    }
  } catch (error) {
    if (!(error instanceof EmbeddingUnavailableError)) throw error
    report.embeddingError = error.message
  }
  return report
}

const embedBatch = async (store: Store, embedder: Embedder, batch: readonly { id: number; text: string }[]): Promise<number> => {
  const passages = batch.flatMap(e => chunksOf(e.text).map((text, seq) => ({ entry: e.id, seq, text })))
  if (passages.length === 0) throw new Error('entries waiting for vectors have no text to embed')
  const vectors = await embedder.embed(
    passages.map(p => p.text),
    'document',
  )
  store.addChunks(passages.map((p, i) => ({ entry: p.entry, seq: p.seq, vector: vectors[i]! })))
  return passages.length
}

const embedPending = async (store: Store, embedder: Embedder, options: IndexOptions, report: IndexReport): Promise<void> => {
  try {
    store.useVectors({ model: embedder.model, dimension: await embedder.dimension() })
    const total = store.countPending()
    let done = 0
    for (;;) {
      const batch = store.pending(EMBED_ENTRIES)
      if (batch.length === 0) return
      report.chunks += await embedBatch(store, embedder, batch)
      done += batch.length
      options.onProgress?.({ phase: 'embedding', done, total })
    }
  } catch (error) {
    if (!(error instanceof EmbeddingUnavailableError)) throw error
    report.embeddingError = error.message
  }
}
