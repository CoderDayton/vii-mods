import { balanceOf, fuse } from '../core/search/fuse'
import type { Lists } from '../core/search/fuse'
import type { Tuning } from '../core/search/tuning'
import { groupBySession, names, newestFirst } from '../core/search/group'
import type { SessionHit } from '../core/search/group'
import { whenOf } from '../core/search/when'
import { holdsEvery, MAX_TERMS, rarest, termsOf, wordsNeeded } from '../core/text/terms'
import { CODE_KINDS, PROSE_KINDS } from '../core/types'
import type { EntryKind, Filter, Ranked, StoredEntry } from '../core/types'
import { withContext } from './context'
import { EmbeddingUnavailableError } from './embedding/embedder'
import type { Embedder } from './embedding/embedder'
import type { Store } from './store/store'

export type SearchOptions = {
  now: number
  limit?: number
  // How many of the best sessions to pass over, to read the ones after them.
  offset?: number
  perSession?: number
  halfLifeDays?: number
  project?: string
  kinds?: readonly EntryKind[]
  since?: number
  excludeSession?: string
  until?: number
  sessionBefore?: Filter['sessionBefore']
  // Words to match beside those of the question.
  extraTerms?: readonly string[]
  order?: 'newest' | 'best'
  // Skip the embedding server and match on words alone.
  keywordOnly?: boolean
  tuning?: Tuning
}

export type SearchResult = {
  hits: SessionHit[]
  // Sessions that matched beyond the ones returned.
  more: number
  terms: string[]
  // Whether vectors took part: used, switched off or left out, or wanted and the server did not answer.
  semantic: 'used' | 'off' | 'unavailable'
}

// How many entries of each sort each search contributes to the fusion, at the least.
const CANDIDATES = 60
// Entries looked at for each session asked for, so a later page still has sessions to show.
const CANDIDATES_PER_SESSION = 6

const DEFAULT_LIMIT = 5
const DEFAULT_PER_SESSION = 2
const DEFAULT_HALF_LIFE_DAYS = 90
// A question may name this many project folders; each is searched apart, so its sessions are in the running.
const NAMED_PROJECTS = 3
// A question that asks for the latest work keeps the sessions that score this share of the best one.
const LATEST_SHARE = 0.5
// How many sessions past the page a list by time counts.
const LISTED_BEYOND = 50
// A long question is read this far, and the rarest of its words are the ones searched.
const READ_TERMS = 24

// What the two searches found for a question, before any ranking: the lists, the entries they name, and how
// many entries of each sort were asked for.
export type Found = { terms: string[]; lists: Lists; entries: StoredEntry[]; asked: number; semantic: SearchResult['semantic']; named: string[] }

const filterOf = (options: SearchOptions): Filter => ({
  project: options.project,
  kinds: options.kinds,
  since: options.since,
  excludeSession: options.excludeSession,
  until: options.until,
  sessionBefore: options.sessionBefore,
})

const merged = (lists: readonly Ranked[][]): Ranked[] => {
  const best = new Map<number, number>()
  for (const r of lists.flat()) best.set(r.id, Math.max(best.get(r.id) ?? -Infinity, r.score))
  return [...best].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}

// Runs the two searches. Unless kinds are asked for, each gives its best prose and its best code apart, so
// neither can fill every place. The meaning search is skipped, not failed, when no embedder is given, none
// was used to build the index, or the server does not answer. A project folder the question names is searched
// apart as well: its sessions may not say its name.
export const retrieve = async (store: Store, embedder: Embedder | null, query: string, options: SearchOptions): Promise<Found> => {
  const written = termsOf(query, READ_TERMS)
  const kept = written.length > MAX_TERMS ? rarest(written, store.termCounts(written, [...PROSE_KINDS, ...CODE_KINDS]).counts, MAX_TERMS) : written
  const terms = [...new Set([...kept, ...(options.extraTerms ?? [])])]
  const limit = options.limit ?? DEFAULT_LIMIT
  const asked = Math.max(CANDIDATES, (Math.max(0, options.offset ?? 0) + limit) * CANDIDATES_PER_SESSION)

  const filter = filterOf(options)
  const named = filter.project === undefined || filter.project === '' ? store.projects().filter(p => names(terms, p)).slice(0, NAMED_PROJECTS) : []
  const scopes: Filter[] = [filter, ...named.map(project => ({ ...filter, project }))]
  const everyKind = options.kinds === undefined || options.kinds.length === 0
  const wordsIn = (scope: Filter): Ranked[] => (everyKind ? [PROSE_KINDS, CODE_KINDS].flatMap(kinds => store.lexical(terms, asked, { ...scope, kinds })) : store.lexical(terms, asked, scope))
  const words = merged(scopes.map(wordsIn))

  let meaning: Ranked[] = []
  let semantic: SearchResult['semantic'] = 'off'
  if (options.keywordOnly !== true && embedder !== null && store.vectors?.model === embedder.model) {
    try {
      const [vector] = await embedder.embed([query], 'query')
      meaning = vector === undefined ? [] : merged(scopes.map(scope => store.semantic(vector, asked, scope, undefined, everyKind ? CODE_KINDS : [])))
      semantic = 'used'
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) throw error
      semantic = 'unavailable'
    }
  }

  const ids = [...new Set([...words, ...meaning].map(r => r.id))]
  const entries = store.entries(ids)
  // A question with topic words beside it has its own filter, so only a plain question holds word matches to a count.
  const needed = (options.extraTerms?.length ?? 0) > 0 ? 1 : wordsNeeded(kept.length)
  const lower = new Map(entries.map(e => [e.id, e.text.toLowerCase()]))
  const enough = (r: Ranked): boolean => needed <= 1 || kept.filter(t => lower.get(r.id)?.includes(t)).length >= needed
  return { terms, lists: { words: words.filter(enough), meaning }, entries, asked, semantic, named }
}

// Every session the searches found, best first: the two lists merged by score with a balance set for the
// question, then grouped by session. `adjust` may drop or rescore the merged entries before they are grouped.
export const rank = (found: Found, options: SearchOptions, adjust: (fused: Ranked[]) => Ranked[] = fused => fused): SessionHit[] => {
  const fused = adjust(fuse(found.lists, balanceOf(found.lists, found.asked, options.tuning), options.tuning))
  return groupBySession(fused, found.entries, {
    now: options.now,
    limit: fused.length,
    perSession: options.perSession ?? DEFAULT_PER_SESSION,
    halfLifeDays: options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    terms: found.terms,
    worded: new Set(found.entries.filter(e => holdsEvery(e.text, found.terms)).map(e => e.id)),
    tuning: options.tuning,
  })
}

const listed = (store: Store, options: SearchOptions, wanted: number): SessionHit[] => {
  // The session asking is not one of the sessions before it.
  const answers = store.lastAnswers(wanted, { ...filterOf(options), sessionBefore: undefined, excludeSession: options.excludeSession ?? options.sessionBefore?.session })
  const ids = answers.map(a => a.id)
  const sessions = groupBySession(answers, store.entries(ids), { now: options.now, limit: ids.length, perSession: 1, halfLifeDays: options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS, worded: new Set(ids) })
  return newestFirst(sessions)
}

const latestOf = (ranked: readonly SessionHit[], named: readonly string[]): SessionHit[] => {
  const least = (ranked[0]?.score ?? 0) * LATEST_SHARE
  return newestFirst(ranked.filter(hit => hit.parent === undefined && (hit.score >= least || named.includes(hit.project))))
}

// Finds past sessions for a question by words and by meaning at once. What the question says about time is
// not searched for: a span ("yesterday", "sept 21") limits the search, unless the options set one, and a word
// for the newest work ("latest") puts the newest sessions first. A question about time alone lists the
// sessions of that time.
export const searchPast = async (store: Store, embedder: Embedder | null, query: string, options: SearchOptions): Promise<SearchResult> => {
  const when = whenOf(query, options.now)
  const scoped: SearchOptions = { ...options, since: options.since ?? when.since, until: options.until ?? when.until }
  const terms = termsOf(when.text)
  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit ?? DEFAULT_LIMIT
  const pageOf = (sessions: readonly SessionHit[]): SessionHit[] => {
    const page = sessions.slice(offset, offset + limit)
    return withContext(store, options.order === 'best' ? page : newestFirst(page))
  }

  if (terms.length === 0) {
    if (!when.latest && when.since === undefined && when.until === undefined) return { hits: [], more: 0, terms, semantic: 'off' }
    const sessions = listed(store, scoped, offset + limit + LISTED_BEYOND)
    const hits = pageOf(sessions)
    return { hits, more: Math.max(0, sessions.length - offset - hits.length), terms, semantic: 'off' }
  }

  const found = await retrieve(store, embedder, when.text, scoped)
  const ranked = rank(found, scoped)
  const sessions = when.latest ? latestOf(ranked, found.named) : ranked
  const hits = pageOf(sessions)
  return { hits, more: Math.max(0, sessions.length - offset - hits.length), terms: found.terms, semantic: found.semantic }
}
