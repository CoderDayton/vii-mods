import type { Entry } from './types'
import { at, editDistance, normalize, overlaps, protectedSpans, soundKey, tokenize } from './text'
import type { Token } from './text'

export type Candidate = {
  kind: 'known' | 'near'
  text: string
  start: number
  end: number
  meant: string
}

const SEPARATOR = /^[\s\-.]+$/
const MIN_NEAR_LENGTH = 6
const MIN_KEY_LENGTH = 4
const MIN_SOUND_TERM_LENGTH = 8

const word = (t: Token): string => t.text.toLowerCase().replace(/'s$/, '')

const isNear = (token: string, term: string): boolean => {
  if (token === term || token.length < MIN_NEAR_LENGTH || term.length < MIN_NEAR_LENGTH) return false
  if (/\d/.test(token) || token === `${term}s` || token === `${term}es`) return false
  if (term.includes(token) || token.includes(term)) return false

  const distance = editDistance(token, term)
  if (distance <= 1) return true

  const key = soundKey(term)
  const isLongSoundAlike =
    term.length >= MIN_SOUND_TERM_LENGTH && key.length >= MIN_KEY_LENGTH && soundKey(token) === key
  return isLongSoundAlike && distance <= 2
}

export const scan = (text: string, entries: readonly Entry[], terms: readonly string[]): Candidate[] => {
  const tokens = tokenize(text)
  const guarded = protectedSpans(text)
  const free = tokens.map(t => !overlaps(t, guarded))
  const used = new Set<number>()
  const found: Candidate[] = []

  const phrases = entries
    .map(e => ({ entry: e, words: normalize(e.heard).split(' ') }))
    .sort((a, b) => b.words.length - a.words.length)

  for (const { entry, words } of phrases) {
    for (let i = 0; i + words.length <= tokens.length; i += 1) {
      const run = tokens.slice(i, i + words.length)
      const isMatch = run.every((t, k) => free[i + k] && !used.has(i + k) && word(t) === words[k])
      const isJoined = run.every(
        (t, k) => k === 0 || SEPARATOR.test(text.slice(at(run, k - 1).end, t.start)),
      )
      if (!isMatch || !isJoined) continue

      const start = at(run, 0).start
      const end = at(run, run.length - 1).end
      found.push({ kind: 'known', text: text.slice(start, end), start, end, meant: entry.meant })
      run.forEach((_, k) => used.add(i + k))
    }
  }

  const known = new Set(terms.map(t => t.toLowerCase()))
  tokens.forEach((t, i) => {
    const w = word(t)
    if (!free[i] || used.has(i) || known.has(w)) return
    const term = terms.find(candidate => isNear(w, candidate.toLowerCase()))
    if (term !== undefined) {
      found.push({ kind: 'near', text: t.text, start: t.start, end: t.end, meant: term })
    }
  })

  return found.sort((a, b) => a.start - b.start)
}
