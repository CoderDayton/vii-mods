import { addLearned, rejectHeard, resolveEntries } from './dictionary'
import type { Dictionary, Entry } from './types'

export type State = { dict: Dictionary; enabled: boolean }

export type Outcome = { text: string; state: State }

const LIST_LIMIT = 40
const MAX_FIELD = 40
const USAGE = 'usage: /dictation [status | on | off | list | add heard=meant | rm heard]'

const status = (state: State): string => {
  const entries = resolveEntries(state.dict)
  const learned = entries.filter(e => e.source !== 'default').length
  return `dictation-repair is ${state.enabled ? 'on' : 'off'} · ${entries.length} entries (${learned} learned)`
}

const list = (state: State): string => {
  const isOwn = (e: Entry): number => (e.source === 'default' ? 1 : 0)
  const entries = resolveEntries(state.dict)
    .slice()
    .sort((a, b) => isOwn(a) - isOwn(b) || (b.at ?? 0) - (a.at ?? 0))
  const lines = entries.slice(0, LIST_LIMIT).map(e => `${e.heard} → ${e.meant} (${e.source})`)
  const more = entries.length > LIST_LIMIT ? [`… ${entries.length - LIST_LIMIT} more`] : []
  return [status(state), ...lines, ...more].join('\n')
}

export const runCommand = (args: string, state: State, now: number): Outcome => {
  const trimmed = args.trim()
  const verb = (trimmed.split(/\s+/)[0] ?? '').toLowerCase()
  const rest = trimmed.slice(verb.length).trim()

  if (verb === '' || verb === 'status') return { text: status(state), state }
  if (verb === 'list') return { text: list(state), state }
  if (verb === 'on' || verb === 'off') {
    const next = { ...state, enabled: verb === 'on' }
    return { text: status(next), state: next }
  }

  if (verb === 'add') {
    const at = rest.indexOf('=')
    const heard = rest.slice(0, at).trim()
    const meant = rest.slice(at + 1).trim()
    if (at < 0 || heard === '' || meant === '' || heard.length > MAX_FIELD || meant.length > MAX_FIELD) {
      return { text: USAGE, state }
    }
    const dict = addLearned(state.dict, { heard, meant }, 'manual', now)
    return { text: `added: ${heard} → ${meant}`, state: { ...state, dict } }
  }

  if (verb === 'rm' && rest !== '') {
    return { text: `removed: ${rest}`, state: { ...state, dict: rejectHeard(state.dict, rest) } }
  }

  return { text: USAGE, state }
}
