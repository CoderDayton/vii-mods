import { emptyLedger, parseLedger } from './rules'
import type { Ledger } from './rules'

// Every session of a folder shares one ledger file. Reads are plain file reads; a write replaces the file
// only while it still holds what the writer read, so two sessions never overwrite each other.

export type RunInit = { env?: Record<string, string>; stdin?: string; timeoutMs?: number }

export type Disk = {
  dir: string
  read: (path: string) => Promise<string | null>
  exists: (path: string) => Promise<boolean>
  run: (argv: string[], init?: RunInit) => Promise<{ exitCode: number; stdout: string }>
}

const STALE = 4
const MAX_TRIES = 12
const RUN_MS = 10_000
const SLUG_MAX = 24

const sh = (script: string, tag: string, ...args: string[]): string[] => ['sh', '-c', script, tag, ...args]

export const DIR_ARGV = sh('printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/correction-ledger"', 'correction-ledger-dir')

// $1 is the ledger file, $OLD what the writer read, stdin what it wants there. Exit 4: the file moved on.
const SWAP = `d=$(dirname "$1") && mkdir -p "$d" || exit 2
exec 9>>"$d/.lock" && flock -w 5 9 || exit 3
cur=$(cat "$1" 2>/dev/null)
[ "$cur" = "$OLD" ] || exit ${STALE}
tmp="$1.$$"
cat > "$tmp" && mv "$tmp" "$1" || { rm -f "$tmp"; exit 5; }`

export const swapArgv = (path: string): string[] => sh(SWAP, 'correction-ledger-swap', path)

const PAUSE_ON = 'mkdir -p "$1" && : > "$1/paused"'
const PAUSE_OFF = 'rm -f "$1/paused"'

export const pauseArgv = (dir: string, paused: boolean): string[] =>
  sh(paused ? PAUSE_ON : PAUSE_OFF, 'correction-ledger-pause', dir)

export const pausedPathOf = (dir: string): string => `${dir}/paused`

export const isPaused = (disk: Disk): Promise<boolean> => disk.exists(pausedPathOf(disk.dir))

const fnv = (text: string, seed: number): number => {
  let h = seed
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16_777_619)
  return h >>> 0
}

// A readable name plus a hash of the whole path, so two folders called "app" stay apart.
export const ledgerPathOf = (dir: string, cwd: string): string => {
  const slug = (cwd.split('/').filter(Boolean).pop() ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const hash = fnv(cwd, 2_166_136_261).toString(36) + fnv(cwd, 1_099_511_627).toString(36)
  return `${dir}/ledger-${slug.slice(0, SLUG_MAX) || 'root'}-${hash}.json`
}

// The file's text with trailing newlines dropped, which is how the swap script reads it back.
const rawOf = async (disk: Disk, path: string): Promise<string> => {
  try {
    return ((await disk.read(path)) ?? '').replace(/\n+$/, '')
  } catch {
    return ''
  }
}

const ledgerOf = (raw: string): Ledger => {
  try {
    return parseLedger(JSON.parse(raw))
  } catch {
    return emptyLedger()
  }
}

export const readLedger = async (disk: Disk, cwd: string): Promise<Ledger> => ledgerOf(await rawOf(disk, ledgerPathOf(disk.dir, cwd)))

export type Change<T> = (ledger: Ledger) => { ledger: Ledger; result: T }

// Reads the folder's ledger, applies the change and swaps the result in. If another session wrote in
// between, the change runs again on what it wrote.
export const updateLedger = async <T>(disk: Disk, cwd: string, change: Change<T>): Promise<T> => {
  const path = ledgerPathOf(disk.dir, cwd)
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const old = await rawOf(disk, path)
    const current = ledgerOf(old)
    const next = change(current)
    if (next.ledger === current) return next.result
    const run = await disk.run(swapArgv(path), { env: { OLD: old }, stdin: JSON.stringify(next.ledger), timeoutMs: RUN_MS })
    if (run.exitCode === 0) return next.result
    if (run.exitCode !== STALE) throw new Error(`correction-ledger: the ledger could not be written (exit ${run.exitCode})`)
  }
  throw new Error('correction-ledger: the ledger kept changing under this write')
}
