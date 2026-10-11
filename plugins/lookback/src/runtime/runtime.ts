import { Database } from 'bun:sqlite'
import { getExtensionPath } from '@sqliteai/sqlite-vector'

import { prepareSqlite } from './store/library'

// The oldest Bun the index is tested on. Keep it equal to the floor of `engines.bun` in package.json.
export const MIN_BUN = '1.4.0'

export type RuntimeInfo = { bun: string; sqlite: string; vector: string }

// SQLite ships inside Bun, so its version moves with Bun's; on macOS it is Homebrew's.
export const runtimeInfo = (): RuntimeInfo => {
  prepareSqlite()
  const db = new Database(':memory:')
  try {
    db.loadExtension(getExtensionPath())
    const row = db.query('select sqlite_version() as sqlite, vector_version() as vector').get() as { sqlite: string; vector: string }
    return { bun: Bun.version, ...row }
  } finally {
    db.close()
  }
}

// The major, minor and patch numbers of a version, or null when it does not start with three numbers. A
// suffix such as "-canary.12" is ignored.
const numbersOf = (version: string): [number, number, number] | null => {
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3])]
}

const isOlder = (a: readonly number[], b: readonly number[]): boolean => {
  const at = a.findIndex((n, i) => n !== b[i])
  return at !== -1 && a[at]! < b[at]!
}

export const runtimeProblem = (bun: string): string | null => {
  const running = numbersOf(bun)
  if (running === null) return `cannot read the Bun version "${bun}"; bun ${MIN_BUN} or newer is needed`
  return isOlder(running, numbersOf(MIN_BUN)!) ? `bun ${MIN_BUN} or newer is needed, running on ${bun}` : null
}
