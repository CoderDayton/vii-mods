import { diffPairs } from './diff'
import type { Pair } from './types'
import { at, editDistance, normalize, soundKey, tokenize } from './text'

export type Prev = { original: string; sent: string; applied: readonly Pair[] }

export type Learned = { learn: Pair[]; unlearn: string[] }

const MAX_WORDS = 3
const MAX_CHARS = 40
const MIN_KEY_LENGTH = 3
const MIN_EDIT_LENGTH = 5
const MAX_TERM_EDIT = 3
const MIN_RESEND_WORDS = 4
const MAX_RESEND_CHANGES = 2
const MAX_RESEND_SHARE = 0.2
const MAX_RESEND_LENGTH_DRIFT = 2

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const wordCount = (s: string): number => s.trim().split(/\s+/).length

export const isPlausiblePair = (
  heard: string,
  meant: string,
  terms: readonly string[],
  isStrict = false,
): boolean => {
  const h = heard.trim()
  const m = meant.trim()
  if (h === '' || m === '' || h.length > MAX_CHARS || m.length > MAX_CHARS) return false
  if (wordCount(h) > MAX_WORDS || wordCount(m) > MAX_WORDS) return false
  if (h.toLowerCase() === m.toLowerCase()) return false

  const hs = squash(h)
  const ms = squash(m)
  if (!/[a-z]/.test(hs) || !/[a-z]/.test(ms)) return false
  if (hs === ms) return true

  const key = soundKey(h)
  if (key.length >= MIN_KEY_LENGTH && key === soundKey(m)) return true

  const longest = Math.max(hs.length, ms.length)
  const distance = editDistance(hs, ms)
  if (!isStrict && longest >= MIN_EDIT_LENGTH && distance <= Math.floor(longest / 3)) return true

  return distance <= MAX_TERM_EDIT && terms.some(t => squash(t) === ms)
}

const WORD = '[\\w.\\-]+'
const ARROW = new RegExp(`(${WORD})\\s*(?:->|→|=>)\\s*(${WORD})`, 'i')
const NOT_FIRST = new RegExp(`\\bnot\\s+["']?(${WORD})["']?(?:\\s*,\\s*|\\s+)(?:but\\s+)?["']?(${WORD})`, 'i')
const NOT_AFTER = new RegExp(`["']?(${WORD})["']?\\s*,?\\s+not\\s+["']?(${WORD})`, 'i')
const MEANT = new RegExp(`\\b(?:i\\s+(?:meant|mean|said)|spelled|spelt)\\s+["']?(${WORD})`, 'i')

const SOFT = new RegExp(
  `^\\W*(?:(?:no|oh)[,\\s]+)?(?:actually|wait)[,\\s]+it(?:['’]?s|\\s+is)\\s+["']?(${WORD})["']?[.!?]*\\s*$`,
  'i',
)

type Claim = { meant: string; heard?: string; isExplicit: boolean; isStrict?: boolean }

const clean = (w: string | undefined): string => (w ?? '').replace(/[.\-]+$/, '')

const claimsFrom = (text: string): Claim[] => {
  const arrow = text.match(ARROW)
  if (arrow !== null) return [{ heard: clean(arrow[1]), meant: clean(arrow[2]), isExplicit: true }]

  const first = text.match(NOT_FIRST)
  if (first !== null) return [{ heard: clean(first[1]), meant: clean(first[2]), isExplicit: false }]

  const after = text.match(NOT_AFTER)
  if (after !== null) return [{ meant: clean(after[1]), heard: clean(after[2]), isExplicit: false }]

  const said = text.match(MEANT)
  if (said !== null) return [{ meant: clean(said[1]), isExplicit: false }]

  const soft = text.match(SOFT)
  if (soft !== null) return [{ meant: clean(soft[1]), isExplicit: false, isStrict: true }]

  return []
}

const isPresent = (prev: Prev, word: string): boolean => {
  const needle = normalize(word)
  return normalize(prev.sent).includes(needle) || normalize(prev.original).includes(needle)
}

const resolveHeard = (
  meant: string,
  prev: Prev,
  terms: readonly string[],
  isStrict: boolean,
): string | undefined => {
  const tokens = tokenize(prev.sent)
  const found = new Map<string, number>()
  for (let size = 1; size <= MAX_WORDS; size += 1) {
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const span = prev.sent.slice(at(tokens, i).start, at(tokens, i + size - 1).end)
      if (!isPlausiblePair(span, meant, terms, isStrict)) continue
      found.set(span, editDistance(squash(span), squash(meant)))
    }
  }
  const ranked = [...found.entries()].sort((a, b) => a[1] - b[1])
  const [best, runnerUp] = ranked
  if (best === undefined) return undefined
  if (runnerUp !== undefined && best[1] === runnerUp[1]) return undefined
  return best[0]
}

const undoneBy = (prev: Prev, word: string): Pair | undefined =>
  prev.applied.find(p => normalize(p.heard) === normalize(word))

const fromResend = (prev: Prev, current: string, terms: readonly string[]): Learned => {
  const none: Learned = { learn: [], unlearn: [] }
  const before = tokenize(prev.sent).length
  const after = tokenize(current).length
  if (before < MIN_RESEND_WORDS || Math.abs(before - after) > MAX_RESEND_LENGTH_DRIFT) return none

  const pairs = diffPairs(prev.sent, current)
  const changed = pairs.reduce((n, p) => n + wordCount(p.heard) + wordCount(p.meant), 0)
  const isSmall = pairs.length > 0 && pairs.length <= MAX_RESEND_CHANGES
  if (!isSmall || changed > Math.max(MAX_RESEND_CHANGES, Math.ceil(before * MAX_RESEND_SHARE) * 2)) return none

  const learn: Pair[] = []
  const unlearn: string[] = []
  for (const p of pairs) {
    const restored = prev.applied.find(
      a => normalize(a.meant) === normalize(p.heard) && normalize(a.heard) === normalize(p.meant),
    )
    if (restored !== undefined) {
      unlearn.push(restored.heard)
    } else if (isPlausiblePair(p.heard, p.meant, terms)) {
      learn.push(p)
    } else {
      return none
    }
  }
  return { learn, unlearn }
}

export const learnFromPrompt = (prev: Prev | null, current: string, terms: readonly string[]): Learned => {
  const none: Learned = { learn: [], unlearn: [] }
  if (prev === null) return none

  const claims = claimsFrom(current)
  if (claims.length === 0) return fromResend(prev, current, terms)

  const learn: Pair[] = []
  const unlearn: string[] = []
  for (const claim of claims) {
    const undo = undoneBy(prev, claim.meant)
    if (undo !== undefined) {
      unlearn.push(undo.heard)
      continue
    }
    const isStrict = claim.isStrict === true
    const heard = claim.heard ?? resolveHeard(claim.meant, prev, terms, isStrict)
    if (heard === undefined) continue
    if (!claim.isExplicit && !isPresent(prev, heard)) continue
    if (!isPlausiblePair(heard, claim.meant, terms, isStrict)) continue
    learn.push({ heard, meant: claim.meant })
  }
  return { learn, unlearn }
}
