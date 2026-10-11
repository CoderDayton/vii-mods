import { fuse } from '../core/search/fuse'
import { groupBySession } from '../core/search/group'
import type { SessionHit } from '../core/search/group'
import { termsOf } from '../core/text/terms'
import type { EntryKind, Filter, Ranked } from '../core/types'
import { EmbeddingUnavailableError } from './embedding/embedder'
import type { Embedder } from './embedding/embedder'
import type { Store } from './store/store'

export type SearchOptions = {
  now: number
  limit?: number
  perSession?: number
  halfLifeDays?: number
  project?: string
  kinds?: readonly EntryKind[]
  since?: number
  excludeSession?: string
  // Skip the embedding server and match on words alone.
  keywordOnly?: boolean
}

export type SearchResult = {
  hits: SessionHit[]
  terms: string[]
  // Whether vectors took part: used, switched off or left out, or wanted and the server did not answer.
  semantic: 'used' | 'off' | 'unavailable'
}

// How many entries each search contributes to the fusion.
const CANDIDATES = 60

const DEFAULT_LIMIT = 5
const DEFAULT_PER_SESSION = 2
const DEFAULT_HALF_LIFE_DAYS = 90

// Finds past sessions for a question by two searches at once, words and meaning, and merges them by rank. The
// meaning search is skipped, not failed, when no embedder is given, none was used to build the index, or the
// server does not answer.
export const searchPast = async (store: Store, embedder: Embedder | null, query: string, options: SearchOptions): Promise<SearchResult> => {
  const terms = termsOf(query)
  if (terms.length === 0) return { hits: [], terms, semantic: 'off' }

  const filter: Filter = { project: options.project, kinds: options.kinds, since: options.since, excludeSession: options.excludeSession }
  const words = store.lexical(terms, CANDIDATES, filter)

  let meaning: Ranked[] = []
  let semantic: SearchResult['semantic'] = 'off'
  if (options.keywordOnly !== true && embedder !== null && store.vectors?.model === embedder.model) {
    try {
      const [vector] = await embedder.embed([query], 'query')
      meaning = vector === undefined ? [] : store.semantic(vector, CANDIDATES, filter)
      semantic = 'used'
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) throw error
      semantic = 'unavailable'
    }
  }

  const fused = fuse([words, meaning]).slice(0, CANDIDATES)
  const entries = store.entries(fused.map(f => f.id))
  const hits = groupBySession(fused, entries, {
    now: options.now,
    limit: options.limit ?? DEFAULT_LIMIT,
    perSession: options.perSession ?? DEFAULT_PER_SESSION,
    halfLifeDays: options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
  })
  return { hits, terms, semantic }
}
