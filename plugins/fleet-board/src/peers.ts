// The other Claude sessions on this machine, read from the registry Claude Code keeps in its config
// folder: one <pid>.json per running session.

import type { Peer, PeerState } from '../types'

export type { Peer, PeerState }

// Prints one registry record per line. A record whose process is gone is left out.
const SCAN = `d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"
for f in "$d"/*.json; do
  [ -f "$f" ] || continue
  pid=$(basename "$f" .json)
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$pid" 2>/dev/null || continue
  cat "$f"; echo
done`

export const SCAN_ARGV: string[] = ['sh', '-c', SCAN, 'fleet-board-scan']

export const baseName = (dir: string): string => dir.split('/').filter(Boolean).pop() ?? dir

// True when `dir` is `root` or inside it. The match is on a path boundary, so /a/proj-2 is not inside /a/proj.
export const isInside = (dir: string, root: string): boolean => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`)

const STATES: Record<string, PeerState> = { busy: 'working', idle: 'idle' }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const parsePeer = (v: unknown): Peer | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const pid = num(r['pid'])
  const id = r['sessionId']
  const dir = r['cwd']
  if (pid === undefined || typeof id !== 'string' || id === '' || typeof dir !== 'string' || dir === '') return null
  const startedAt = num(r['startedAt']) ?? 0
  const name = typeof r['name'] === 'string' && r['name'] !== '' ? r['name'] : baseName(dir)
  const status = typeof r['status'] === 'string' ? r['status'] : ''
  return {
    id,
    pid,
    name,
    dir,
    state: STATES[status] ?? 'unknown',
    startedAt,
    updatedAt: num(r['statusUpdatedAt']) ?? num(r['updatedAt']) ?? startedAt,
  }
}

export const parsePeers = (stdout: string): Peer[] => {
  const out: Peer[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    try {
      const p = parsePeer(JSON.parse(line))
      if (p !== null) out.push(p)
    } catch {
      // A partial or foreign line is not a session.
    }
  }
  return out
}

export const fmtAge = (ms: number): string => {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export type Resolved = { peer: Peer } | { error: string }

// A target is a row number, a name, a folder name, or a unique start of a name.
export const resolvePeer = (peers: readonly Peer[], query: string): Resolved => {
  if (peers.length === 0) return { error: 'no other Claude session is running' }
  const q = query.trim().toLowerCase()
  const number = /^\d+$/.test(q) ? peers[Number(q) - 1] : undefined
  if (number !== undefined) return { peer: number }
  const tiers = [
    (p: Peer) => p.id.toLowerCase() === q,
    (p: Peer) => p.name.toLowerCase() === q,
    (p: Peer) => baseName(p.dir).toLowerCase() === q,
    (p: Peer) => p.name.toLowerCase().startsWith(q),
  ]
  for (const match of tiers) {
    const found = peers.filter(match)
    const first = found[0]
    if (found.length === 1 && first !== undefined) return { peer: first }
    if (found.length > 1) return { error: `${query} matches several sessions: ${found.map(p => p.name).join(', ')}` }
  }
  return { error: `no running session matches "${query}"` }
}
