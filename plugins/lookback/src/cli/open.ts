import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Config } from '../runtime/config'
import { OpenAIEmbedder } from '../runtime/embedding/embedder'
import { StoreMissingError } from '../runtime/store/errors'
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
