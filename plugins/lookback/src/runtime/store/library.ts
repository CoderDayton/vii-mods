import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

// Where Homebrew puts its SQLite: Apple silicon, then Intel.
const HOMEBREW = ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']

export class SqliteLibraryError extends Error {
  override readonly name = 'SqliteLibraryError'
}

type Env = Readonly<Record<string, string | undefined>>

// The SQLite library to run on in place of the one Bun brings, or null to keep Bun's. On macOS Bun uses
// Apple's SQLite, which is built without extension loading, so another build is needed there.
export const sqliteLibraryFor = (platform: string, env: Env, exists: (path: string) => boolean = existsSync): string | null => {
  const named = env.LOOKBACK_SQLITE_LIB
  if (named !== undefined && named !== '') {
    if (!exists(named)) throw new SqliteLibraryError(`LOOKBACK_SQLITE_LIB names ${named}, which is not there`)
    return named
  }
  if (platform !== 'darwin') return null
  const found = HOMEBREW.find(exists)
  if (found === undefined) {
    throw new SqliteLibraryError('macOS needs a SQLite that can load extensions: run "brew install sqlite", or set LOOKBACK_SQLITE_LIB to a libsqlite3.dylib')
  }
  return found
}

let prepared = false

// Bun takes the library once per process, and only before the first database is opened.
export const prepareSqlite = (): void => {
  if (prepared) return
  const library = sqliteLibraryFor(process.platform, process.env)
  if (library !== null) Database.setCustomSQLite(library)
  prepared = true
}
