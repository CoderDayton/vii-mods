import { COMMON_SHARE, tellingTerms } from '../core/search/gate'
import { newestFirst } from '../core/search/group'
import type { SessionHit } from '../core/search/group'
import { candidatesOf, onTopic, topicTerms } from '../core/search/topic'
import { ASKED_TUNING } from '../core/search/tuning'
import { termsOf } from '../core/text/terms'
import type { EntryKind } from '../core/types'
import { withContext } from './context'
import type { Embedder } from './embedding/embedder'
import { rank, retrieve } from './search'
import type { SearchOptions } from './search'
import type { Store } from './store/store'

const SESSIONS = 2
const PER_SESSION = 2
const SPOKEN: readonly EntryKind[] = ['user', 'assistant']
const LAST_PROMPT_CHARS = 600
const LAST_ANSWER_CHARS = 2000
// What an entry of the session asking scores over the same entry of another session.
const OWN_BOOST = 1.5

export type AskedOptions = {
  now: number
  session: string
  limit?: number
}

export type Asked = { hits: SessionHit[]; terms: string[] }

const flat = (text: string | null, max: number): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// What past turns say about a question that points back at earlier work (\"did you rebuild it?\"). Such a
// question seldom names its topic, so the words of the exchange just before it are searched for too, and an
// entry is shown only when it holds enough of them. The session asking is searched up to that exchange,
// which would else match itself.
export const recallAsked = async (store: Store, embedder: Embedder | null, prompt: string, options: AskedOptions): Promise<Asked> => {
  const asked = termsOf(prompt)
  const lastPrompt = store.lastSaid(options.session, 'user', options.now, prompt)
  const lastAnswer = store.lastSaid(options.session, 'assistant', options.now)
  const exchange = `${flat(lastPrompt?.text ?? null, LAST_PROMPT_CHARS)} ${flat(lastAnswer?.text ?? null, LAST_ANSWER_CHARS)}`
  const candidates = candidatesOf(exchange, asked)

  const words = [...asked, ...candidates.map(c => c.term)]
  const { total, counts } = store.termCounts(words, SPOKEN, COMMON_SHARE)
  const around = topicTerms(candidates, counts.slice(asked.length), total)
  const topic = [...tellingTerms(asked, counts, total), ...around]
  if (topic.length === 0) return { hits: [], terms: [] }

  const search: SearchOptions = {
    now: options.now,
    limit: options.limit ?? SESSIONS,
    perSession: PER_SESSION,
    until: options.now,
    extraTerms: around,
    tuning: ASKED_TUNING,
    sessionBefore: { session: options.session, ts: lastPrompt?.ts ?? 0 },
  }
  const found = await retrieve(store, embedder, prompt, search)
  const byId = new Map(found.entries.map(e => [e.id, e]))
  const sessions = rank(found, search, fused =>
    fused
      .filter(r => onTopic(byId.get(r.id)?.text ?? '', topic))
      .map(r => (byId.get(r.id)?.session === options.session ? { ...r, score: r.score * OWN_BOOST } : r))
      .sort((a, b) => b.score - a.score),
  )
  const hits = withContext(store, newestFirst(sessions.slice(0, search.limit))).map(hit => (hit.session === options.session ? { ...hit, own: true as const } : hit))
  return { hits, terms: found.terms }
}
