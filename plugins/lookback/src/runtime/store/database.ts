import { Database } from 'bun:sqlite'
import { getExtensionPath } from '@sqliteai/sqlite-vector'

import { StoreBusyError } from './errors'
import { prepareSqlite } from './library'

// How long a statement waits for another connection's write to finish before it fails.
const BUSY_TIMEOUT_MS = 5000

export type Params = Record<string, string | number | Uint8Array | null>

// Opens the index file with the vector extension loaded. Write-ahead logging lets any number of readers work
// while one connection writes.
export const openDatabase = (path: string, readOnly: boolean): Database => {
  prepareSqlite()
  const db = new Database(path, readOnly ? { readonly: true, strict: true } : { readwrite: true, create: true, strict: true })
  try {
    db.loadExtension(getExtensionPath())
    db.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`)
    if (!readOnly) db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

const isLocked = (error: unknown): boolean => error instanceof Error && /database is locked|SQLITE_BUSY/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`)

// Takes the right to write the index for as long as the returned handle stays open. The lock is a transaction
// on a file beside the index, so the system frees it when the process dies, however it dies.
export const acquireWriteLock = (path: string): Database => {
  prepareSqlite()
  const lock = new Database(`${path}.lock`, { readwrite: true, create: true })
  try {
    lock.exec('pragma busy_timeout = 0; begin exclusive')
    return lock
  } catch (error) {
    lock.close()
    throw isLocked(error) ? new StoreBusyError(path) : error
  }
}
