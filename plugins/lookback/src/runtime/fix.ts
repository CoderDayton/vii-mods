import { errorGist, sameError, weightOf } from '../core/search/fix'
import type { Fix } from '../core/search/fix'
import { groupBySession } from '../core/search/group'
import { DEFAULT_TUNING } from '../core/search/tuning'
import { termsOf } from '../core/text/terms'
import type { Filter, StoredEntry } from '../core/types'
import type { Store } from './store/store'

export type FixOptions = {
  now: number
  limit?: number
  project?: string
  since?: number
  excludeSession?: string
}

export type FixResult = { fixes: Fix[]; terms: string[] }

const CANDIDATES = 80
const DEFAULT_LIMIT = 3
const HALF_LIFE_DAYS = 90
const MAX_TERMS = 10
const FOLLOWERS = 12
const MAX_COMMANDS = 2
// Every session that hit the error counts, however short its copy of the error text.
const TUNING = { ...DEFAULT_TUNING, minShare: 0, projectBoost: 1 }

// What was done about an error before the user's next prompt: the first commands and the first edit, in the
// order they happened.
const stepsAfter = (followers: readonly StoredEntry[]): Fix['then'] => {
  const next = followers.findIndex(e => e.kind === 'user')
  const turn = next === -1 ? followers : followers.slice(0, next)
  const kept = new Set([...turn.filter(e => e.kind === 'cmd').slice(0, MAX_COMMANDS), ...turn.filter(e => e.kind === 'edit').slice(0, 1)])
  return turn.filter(e => kept.has(e)).map(e => ({ kind: e.kind, text: e.text }))
}

// Finds past sessions that hit the same error, by its words, with what each did about it and how that turn
// ended. A session that ran and changed nothing after the error is left out: talk about an error is no way
// past it.
export const findFixes = (store: Store, error: string, options: FixOptions): FixResult => {
  const terms = termsOf(error, MAX_TERMS)
  if (terms.length === 0) return { fixes: [], terms }

  const filter: Filter = { project: options.project, since: options.since, excludeSession: options.excludeSession, kinds: ['error'] }
  const ranked = store.lexical(terms, CANDIDATES, filter)
  const { total, counts } = store.termCounts(terms, 'error')
  const weights = new Map(terms.map((t, i) => [t, weightOf(counts[i] ?? 0, total)]))
  const same = store.entries(ranked.map(r => r.id)).filter(e => sameError(e.text, weights))
  const sessions = groupBySession(ranked, same, { now: options.now, limit: ranked.length, perSession: 1, halfLifeDays: HALF_LIFE_DAYS, tuning: TUNING })

  const fixes: Fix[] = []
  for (const hit of sessions) {
    const found = hit.entries[0]
    if (found === undefined) continue
    const steps = stepsAfter(store.followers(found.id, ['cmd', 'edit', 'user'], FOLLOWERS))
    if (steps.length === 0) continue
    const { ended } = store.turnOf(found.id)
    const then = ended === undefined ? steps : [...steps, { kind: 'assistant' as const, text: ended }]
    fixes.push({ session: hit.session, project: hit.project, ts: hit.ts, error: errorGist(found.text), then })
    if (fixes.length === (options.limit ?? DEFAULT_LIMIT)) break
  }
  return { fixes, terms }
}
