import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Config } from '../runtime/config'
import { OpenAIEmbedder } from '../runtime/embedding/embedder'
import { refreshSession } from '../runtime/indexer'
import { StoreBusyError, StoreMissingError } from '../runtime/store/errors'
import { Store } from '../runtime/store/store'
import { EXIT } from './io'
import type { ExitCode, Io } from './io'

export type Opened = { store: Store } | { code: ExitCode }

// Opens the index for reading and says why not, in the user's terms, when it cannot be.
export const openForReading = (config: Config, io: Io): Opened => {
  try {
    return { store: Store.open(config.databasePath, { readOnly: true }) }
  } catch (error) {
    if (!(error instanceof StoreMissingError)) throw error
    io.stderr(`lookback: ${error.message}\n`)
    return { code: EXIT.noIndex }
  }
}

// Throws StoreBusyError when another index run holds the index.
export const openForWriting = async (config: Config): Promise<Store> => {
  await mkdir(dirname(config.databasePath), { recursive: true })
  return Store.open(config.databasePath)
}

export type EmbedderTimeouts = { timeoutMs?: number }

export const embedderFor = (config: Config, options: EmbedderTimeouts = {}): OpenAIEmbedder =>
  new OpenAIEmbedder({ ...config.embedding, timeoutMs: options.timeoutMs, maxRetries: options.timeoutMs === undefined ? 1 : 0 })

// The new turns of a session get this long to embed, a request at a time.
const REFRESH_EMBED_TIMEOUT_MS = 4000

// Reads the turns a session has had since the index last ran. Another index run holds the index at times;
// the caller then goes on with what the index has.
export const refreshFor = async (config: Config, session: string): Promise<void> => {
  let store
  try {
    store = await openForWriting(config)
  } catch (error) {
    if (error instanceof StoreBusyError) return
    throw error
  }
  try {
    await refreshSession(store, { projectsRoot: config.projectsRoot, session, embedder: embedderFor(config, { timeoutMs: REFRESH_EMBED_TIMEOUT_MS }) })
  } catch {
    // A refresh only brings the index up to date; a search that goes on without it is still an answer.
  } finally {
    store.close()
  }
}
