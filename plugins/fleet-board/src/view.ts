import { baseName, fmtAge } from './peers'
import type { Peer, PeerState } from './peers'
import { roleOf } from './roles'
import type { Hire } from './fleet'

export type Row = {
  n: number
  id: string
  name: string
  folder: string
  state: PeerState
  age: string
  isQuiet: boolean
  role: string
}

// A working session that has not changed state for the quiet time is the one to look at.
export const rowsOf = (peers: readonly Peer[], roster: Readonly<Record<string, Hire>>, now: number, quietMs: number): Row[] =>
  peers.map((p, i) => {
    const hire = roster[p.id]
    const since = now - p.updatedAt
    return {
      n: i + 1,
      id: p.id,
      name: p.name,
      folder: baseName(p.dir),
      state: p.state,
      age: fmtAge(since),
      isQuiet: p.state === 'working' && since > quietMs,
      role: (hire !== undefined ? roleOf(hire.role)?.label : undefined) ?? '—',
    }
  })

export type Layout = { wide: boolean; name: number; folder: number; age: number }

// "1: " in front of a name, the way a plain Button draws its hotkey.
export const KEY_WIDTH = 3
const WIDE_AT = 90
const NAME_MAX = 24
const FOLDER_MAX = 18
const NAME_MIN = 12
// Pane padding, the pick mark, the state dot, the state word, and the gaps between those cells.
const NARROW_FIXED = 15

const widthOf = (cells: string[], max: number): number => Math.min(max, Math.max(1, ...cells.map(c => c.length)))

// A wide pane shows a session on one line; a narrow one gives the name what the other cells leave.
export const layoutOf = (columns: number, rows: readonly Row[]): Layout => {
  const age = widthOf(rows.map(r => (r.isQuiet ? `${r.age} !` : r.age)), 8)
  if (columns >= WIDE_AT) {
    return { wide: true, name: widthOf(rows.map(r => r.name), NAME_MAX) + KEY_WIDTH, folder: widthOf(rows.map(r => r.folder), FOLDER_MAX), age }
  }
  return { wide: false, name: Math.max(NAME_MIN, columns - NARROW_FIXED - age), folder: 0, age }
}

const DIRS_KEPT = 40

export const dirOptions = (root: string, peers: readonly Peer[], siblings: readonly string[]): { value: string; label: string }[] =>
  [...new Set([root, ...peers.map(p => p.dir), ...siblings])]
    .slice(0, DIRS_KEPT)
    .map(dir => ({ value: dir, label: `${baseName(dir)} (${dir})` }))

export const headline = (rows: readonly Row[]): string => {
  if (rows.length === 0) return 'no other sessions'
  const working = rows.filter(r => r.state === 'working').length
  const team = rows.filter(r => r.role !== '—').length
  return `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'} · ${working} working · ${team} on the team`
}
