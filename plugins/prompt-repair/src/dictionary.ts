import { ALL_ENTRIES } from './glossary'
import { normalize } from './text'
import type { Dictionary, Entry, Pair } from './types'

export const MAX_LEARNED = 300

export const emptyDictionary = (): Dictionary => ({ learned: [], rejected: [] })

const isEntry = (v: unknown): v is Entry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Entry).heard === 'string' &&
  typeof (v as Entry).meant === 'string'

export const normalizeDictionary = (raw: unknown): Dictionary => {
  if (typeof raw !== 'object' || raw === null) return emptyDictionary()
  const { learned, rejected } = raw as Partial<Dictionary>
  return {
    learned: Array.isArray(learned) ? learned.filter(isEntry) : [],
    rejected: Array.isArray(rejected) ? rejected.filter(r => typeof r === 'string') : [],
  }
}

export const resolveEntries = (
  dict: Dictionary,
  defaults: readonly Entry[] = ALL_ENTRIES,
): Entry[] => {
  const byHeard = new Map<string, Entry>()
  for (const e of [...defaults, ...dict.learned]) {
    byHeard.set(normalize(e.heard), e)
  }
  for (const r of dict.rejected) {
    byHeard.delete(normalize(r))
  }
  return [...byHeard.values()]
}

export const addLearned = (
  dict: Dictionary,
  pair: Pair,
  source: 'learned' | 'manual',
  at: number,
): Dictionary => {
  const key = normalize(pair.heard)
  const isRejected = dict.rejected.some(r => normalize(r) === key)
  if (isRejected && source !== 'manual') return dict

  const learned = dict.learned.filter(e => normalize(e.heard) !== key)
  learned.push({ heard: pair.heard, meant: pair.meant, source, at })
  return {
    learned: learned.slice(-MAX_LEARNED),
    rejected: dict.rejected.filter(r => normalize(r) !== key),
  }
}

export const rejectHeard = (dict: Dictionary, heard: string): Dictionary => {
  const key = normalize(heard)
  return {
    learned: dict.learned.filter(e => normalize(e.heard) !== key),
    rejected: dict.rejected.some(r => normalize(r) === key) ? dict.rejected : [...dict.rejected, heard],
  }
}
