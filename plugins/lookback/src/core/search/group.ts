import { CODE_KINDS } from '../types'
import type { EntryKind, Ranked, StoredEntry } from '../types'
import { DEFAULT_TUNING } from './tuning'
import type { Tuning } from './tuning'

export type HitEntry = {
  id: number
  kind: EntryKind
  text: string
  score: number
  // The turn the entry is in, by the id of the prompt that opened it: that prompt, the last thing Claude said
  // in the turn, and what the user typed next.
  turn?: number
  asked?: string
  ended?: string
  reply?: string
}

export type SessionHit = {
  session: string
  // For a sub-agent run, the session that started it.
  parent?: string
  project: string
  ts: number
  score: number
  entries: HitEntry[]
  // The files the session changed, the most changed first.
  files?: string[]
  title?: string
  // Set for the session that asked: these are its own earlier turns.
  own?: true
}

export type GroupOptions = {
  now: number
  limit: number
  perSession: number
  halfLifeDays: number
  terms?: readonly string[]
  // The ids of the entries that hold every word of the question. A session with one is never left out as weak.
  worded?: ReadonlySet<number>
  tuning?: Tuning
}

const DAY_MS = 86_400_000

// A match from today counts in full; an old one keeps at least 60%, so a strong old match still shows.
const recency = (ts: number, now: number, halfLifeDays: number): number => {
  const ageDays = Math.max(0, now - ts) / DAY_MS
  return 0.6 + 0.4 * 0.5 ** (ageDays / halfLifeDays)
}

const sameText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200)

// Whether the question holds a whole word of the project's folder name: "garden" names glowseed-garden.
export const names = (terms: readonly string[], project: string): boolean => {
  const words = (project.split('/').filter(Boolean).pop() ?? '').toLowerCase().split(/[^a-z0-9]+/)
  return terms.some(t => words.includes(t.toLowerCase()))
}

export const newestFirst = (hits: readonly SessionHit[]): SessionHit[] => [...hits].sort((a, b) => b.ts - a.ts)

const isCode = (entry: HitEntry): boolean => CODE_KINDS.includes(entry.kind)

// The entries of a session to show, best first and once each: a failure that was retried leaves the same text
// many times. A session where something said matched shows one line of code at most, so that edits of one
// file do not take every place.
const shown = (entries: HitEntry[], max: number): HitEntry[] => {
  const seen = new Set<string>()
  const ranked = entries.sort((a, b) => b.score - a.score).filter(e => !seen.has(sameText(e.text)) && seen.add(sameText(e.text)))
  if (ranked.every(isCode)) return ranked.slice(0, max)
  const firstCode = ranked.find(isCode)
  return ranked.filter(e => !isCode(e) || e === firstCode).slice(0, max)
}

export const groupBySession = (fused: readonly Ranked[], entries: readonly StoredEntry[], options: GroupOptions): SessionHit[] => {
  const tuning = options.tuning ?? DEFAULT_TUNING
  const byId = new Map(entries.map(e => [e.id, e]))
  const sessions = new Map<string, SessionHit>()
  const holdsWord = new Set<string>()

  for (const { id, score } of fused) {
    const found = byId.get(id)
    if (found === undefined) continue
    const weighted = score * tuning.kindWeight[found.kind] * (found.parent === undefined ? 1 : tuning.subAgentWeight)
    const fresh: SessionHit = { session: found.session, project: found.project, ts: found.ts, score: 0, entries: [] }
    if (found.parent !== undefined) fresh.parent = found.parent
    const hit = sessions.get(found.session) ?? fresh
    if (options.worded?.has(id) === true) holdsWord.add(found.session)
    hit.entries.push({ id, kind: found.kind, text: found.text, score: weighted })
    if (weighted > hit.score) Object.assign(hit, { score: weighted, ts: found.ts })
    sessions.set(found.session, hit)
  }

  const ranked = [...sessions.values()]
    .map(hit => ({
      ...hit,
      score: hit.score * recency(hit.ts, options.now, options.halfLifeDays) * (names(options.terms ?? [], hit.project) ? tuning.projectBoost : 1),
      entries: shown(hit.entries, options.perSession),
    }))
    .sort((a, b) => b.score - a.score)
  const least = (ranked[0]?.score ?? 0) * tuning.minShare
  return ranked.filter(hit => hit.score >= least || holdsWord.has(hit.session)).slice(0, options.limit)
}
