import { balanceOf, fuse } from '../core/search/fuse'
import type { Lists } from '../core/search/fuse'
import type { Tuning } from '../core/search/tuning'
import { groupBySession } from '../core/search/group'
import type { SessionHit } from '../core/search/group'
import { holdsEvery, termsOf } from '../core/text/terms'
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

// What the two searches found for a question, before any ranking: the lists, the entries they name, and how
// many entries of each sort were asked for.
export type Found = { terms: string[]; lists: Lists; entries: StoredEntry[]; asked: number; semantic: SearchResult['semantic'] }

// Runs the two searches. Unless kinds are asked for, each gives its best prose and its best code apart, so
// neither can fill every place. The meaning search is skipped, not failed, when no embedder is given, none
// was used to build the index, or the server does not answer.
export const retrieve = async (store: Store, embedder: Embedder | null, query: string, options: SearchOptions): Promise<Found> => {
  const terms = termsOf(query)
  const limit = options.limit ?? DEFAULT_LIMIT
  const asked = Math.max(CANDIDATES, (Math.max(0, options.offset ?? 0) + limit) * CANDIDATES_PER_SESSION)

  const filter: Filter = { project: options.project, kinds: options.kinds, since: options.since, excludeSession: options.excludeSession }
  const everyKind = options.kinds === undefined || options.kinds.length === 0
  const words = everyKind
    ? [PROSE_KINDS, CODE_KINDS].flatMap(kinds => store.lexical(terms, asked, { ...filter, kinds })).sort((a, b) => b.score - a.score)
    : store.lexical(terms, asked, filter)

  let meaning: Ranked[] = []
  let semantic: SearchResult['semantic'] = 'off'
  if (options.keywordOnly !== true && embedder !== null && store.vectors?.model === embedder.model) {
    try {
      const [vector] = await embedder.embed([query], 'query')
      meaning = vector === undefined ? [] : store.semantic(vector, asked, filter, undefined, everyKind ? CODE_KINDS : [])
      semantic = 'used'
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) throw error
      semantic = 'unavailable'
    }
  }

  const ids = [...new Set([...words, ...meaning].map(r => r.id))]
  return { terms, lists: { words, meaning }, entries: store.entries(ids), asked, semantic }
}

// Every session the searches found, best first: the two lists merged by score with a balance set for the
// question, then grouped by session.
export const rank = (found: Found, options: SearchOptions): SessionHit[] => {
  const fused = fuse(found.lists, balanceOf(found.lists, found.asked, options.tuning), options.tuning)
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

// Finds past sessions for a question by words and by meaning at once.
export const searchPast = async (store: Store, embedder: Embedder | null, query: string, options: SearchOptions): Promise<SearchResult> => {
  const terms = termsOf(query)
  if (terms.length === 0) return { hits: [], more: 0, terms, semantic: 'off' }

  const found = await retrieve(store, embedder, query, options)
  const sessions = rank(found, options)
  const offset = Math.max(0, options.offset ?? 0)
  const hits = withContext(store, sessions.slice(offset, offset + (options.limit ?? DEFAULT_LIMIT)))
  return { hits, more: Math.max(0, sessions.length - offset - hits.length), terms, semantic: found.semantic }
}
