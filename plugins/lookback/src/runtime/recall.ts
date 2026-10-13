import { COMMON_SHARE, MIN_SIMILARITY, answers, tellingTerms, worthAsking } from '../core/search/gate'
import { newestFirst } from '../core/search/group'
import type { HitEntry, SessionHit } from '../core/search/group'
import { termsOf } from '../core/text/terms'
import type { EntryKind } from '../core/types'
import { withContext } from './context'
import { EmbeddingUnavailableError } from './embedding/embedder'
import type { Embedder } from './embedding/embedder'
import type { Store } from './store/store'

const PROMPT_TERMS = 12
const NEAREST = 12
const SESSIONS = 2
const SPOKEN: readonly EntryKind[] = ['user', 'assistant']

export type RecallOptions = {
  now: number
  // The folder the prompt was typed in. Only what happened in it is recalled.
  project: string
  // The session asking, which is never recalled to itself.
  exclude: string
  // Sessions already shown, by the start of their ids.
  skip: ReadonlySet<string>
  limit?: number
}

export type Recall = { hits: SessionHit[]; terms: string[] }

const NOTHING: Recall = { hits: [], terms: [] }

const folderOf = (path: string): string => path.replace(/\/+$/, '')

// Past sessions of this folder that already answer a prompt: what was said there means nearly the same and
// shares words that tell entries apart. Nothing when none does, which is most of the time.
export const recallPast = async (store: Store, embedder: Embedder | null, prompt: string, options: RecallOptions): Promise<Recall> => {
  if (!worthAsking(prompt) || embedder === null || store.vectors?.model !== embedder.model) return NOTHING

  const terms = termsOf(prompt, PROMPT_TERMS)
  const { total, counts } = store.termCounts(terms, SPOKEN, COMMON_SHARE)
  const telling = tellingTerms(terms, counts, total)
  if (telling.length === 0) return NOTHING

  let nearest: ReturnType<Store['semantic']>
  try {
    const [vector] = await embedder.embed([prompt], 'query')
    if (vector === undefined) return NOTHING
    nearest = store.semantic(vector, NEAREST, { project: options.project, kinds: SPOKEN, excludeSession: options.exclude }, 1 - MIN_SIMILARITY)
  } catch (error) {
    if (error instanceof EmbeddingUnavailableError) return NOTHING
    throw error
  }

  const byId = new Map(store.entries(nearest.map(r => r.id)).map(e => [e.id, e]))
  const folder = folderOf(options.project)
  const shown = [...options.skip]
  const sessions = new Map<string, SessionHit>()
  for (const { id, score } of nearest) {
    const found = byId.get(id)
    if (found === undefined || folderOf(found.project) !== folder || shown.some(s => found.session.startsWith(s)) || !answers(score, found.text, telling)) continue
    const entry: HitEntry = { id, kind: found.kind, text: found.text, score }
    const hit = sessions.get(found.session)
    if (hit !== undefined) continue
    sessions.set(found.session, { session: found.session, project: found.project, ts: found.ts, score, entries: [entry], ...(found.parent === undefined ? {} : { parent: found.parent }) })
  }
  return { hits: withContext(store, newestFirst([...sessions.values()].slice(0, options.limit ?? SESSIONS))), terms: telling }
}
