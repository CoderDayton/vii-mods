import { termsOf } from '../text/terms'
import { COMMON_SHARE, sharedTerms } from './gate'

export const TOPIC_TERMS = 8
// How many topic words an entry must hold to be shown.
export const MIN_ON_TOPIC = 3
// A word held by fewer entries is a typo or a one-off name.
const MIN_HELD = 3
const MAX_CANDIDATES = 200

export type Candidate = { term: string; said: number }

// Whether a term can name a topic: it has three letters in a row, and is not a number, a hash or an id.
export const isWord = (term: string): boolean => /[a-z]{3}/.test(term) && !/^(0x)?[0-9a-f]{6,}$/.test(term) && !/\d{3}/.test(term)

export const candidatesOf = (text: string, skip: readonly string[] = []): Candidate[] => {
  const said = new Map<string, number>()
  for (const word of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) said.set(word, (said.get(word) ?? 0) + 1)
  return termsOf(text, MAX_CANDIDATES)
    .filter(term => isWord(term) && !skip.includes(term))
    .map(term => ({ term, said: said.get(term) ?? 1 }))
}

// The words a text is about, best first: said often in it, and held by few of the `total` entries. `held`
// holds, for each candidate, how many entries hold it.
export const topicTerms = (candidates: readonly Candidate[], held: readonly number[], total: number, max: number = TOPIC_TERMS): string[] =>
  candidates
    .map((c, i) => ({ term: c.term, said: c.said, held: held[i] ?? 0 }))
    .filter(c => c.held >= MIN_HELD && c.held / Math.max(1, total) <= COMMON_SHARE)
    .map(c => ({ term: c.term, weight: Math.sqrt(c.said) * Math.log(Math.max(1, total) / c.held) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(c => c.term)

export const onTopic = (text: string, topic: readonly string[]): boolean => topic.length > 0 && sharedTerms(text, topic).length >= Math.min(MIN_ON_TOPIC, topic.length)
