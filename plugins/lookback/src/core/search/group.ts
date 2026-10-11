import type { EntryKind, Ranked, StoredEntry } from '../types'

export type HitEntry = { id: number; kind: EntryKind; text: string; score: number }

export type SessionHit = {
  session: string
  project: string
  ts: number
  score: number
  entries: HitEntry[]
}

export type GroupOptions = {
  now: number
  limit: number
  perSession: number
  halfLifeDays: number
}

// What a person said, and what failed, says more about a session than a command that ran in it.
const KIND_WEIGHT: Record<EntryKind, number> = { user: 1.15, error: 1.15, assistant: 1, cmd: 0.85 }

const DAY_MS = 86_400_000

// A match from today counts in full; an old one keeps at least 60%, so a strong old match still shows.
const recency = (ts: number, now: number, halfLifeDays: number): number => {
  const ageDays = Math.max(0, now - ts) / DAY_MS
  return 0.6 + 0.4 * 0.5 ** (ageDays / halfLifeDays)
}

const sameText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200)

// The best entries of a session, once each: a failure that was retried leaves the same text many times.
const distinct = (entries: HitEntry[], max: number): HitEntry[] => {
  const seen = new Set<string>()
  return entries
    .sort((a, b) => b.score - a.score)
    .filter(e => !seen.has(sameText(e.text)) && seen.add(sameText(e.text)))
    .slice(0, max)
}

export const groupBySession = (fused: readonly Ranked[], entries: readonly StoredEntry[], options: GroupOptions): SessionHit[] => {
  const byId = new Map(entries.map(e => [e.id, e]))
  const sessions = new Map<string, SessionHit>()

  for (const { id, score } of fused) {
    const found = byId.get(id)
    if (found === undefined) continue
    const weighted = score * KIND_WEIGHT[found.kind]
    const hit = sessions.get(found.session) ?? { session: found.session, project: found.project, ts: found.ts, score: 0, entries: [] }
    hit.entries.push({ id, kind: found.kind, text: found.text, score: weighted })
    if (weighted > hit.score) Object.assign(hit, { score: weighted, ts: found.ts })
    sessions.set(found.session, hit)
  }

  return [...sessions.values()]
    .map(hit => ({
      ...hit,
      score: hit.score * recency(hit.ts, options.now, options.halfLifeDays),
      entries: distinct(hit.entries, options.perSession),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit)
}
