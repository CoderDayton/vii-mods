import type { Register } from 'claude-code'

import { cleanup } from '../src/cleanup'
import { runCommand } from '../src/commands'
import type { State } from '../src/commands'
import { addLearned, normalizeDictionary, rejectHeard, resolveEntries } from '../src/dictionary'
import { TERMS } from '../src/glossary'
import { learnFromPrompt } from '../src/learn'
import type { Prev } from '../src/learn'
import { acceptReply, buildRequest } from '../src/repair'
import type { Request } from '../src/repair'
import { scan } from '../src/scan'
import { spokenForms } from '../src/spoken'
import { normalize, tokenize } from '../src/text'
import type { Pair } from '../src/types'

const MODEL = 'haiku'
const TIMEOUT_MS = 8000
const MAX_CHARS = 4000
const MIN_WORDS = 2
const BASE_TOKENS = 64

const KEY_DICTIONARY = 'dictionary'
const KEY_ENABLED = 'enabled'

type Store = {
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
}

const load = async ($: Store): Promise<State> => ({
  dict: normalizeDictionary(await $.store.get(KEY_DICTIONARY)),
  enabled: (await $.store.get(KEY_ENABLED)) !== false,
})

const save = async ($: Store, state: State): Promise<void> => {
  await $.store.set(KEY_DICTIONARY, state.dict)
  await $.store.set(KEY_ENABLED, state.enabled)
}

const isOwn = (origin: { kind: string } | undefined): boolean =>
  origin === undefined || origin.kind === 'composer' || origin.kind === 'bridge'

const isSkipped = (text: string): boolean => {
  const trimmed = text.trim()
  const isCommand = trimmed.startsWith('/') || trimmed.startsWith('!')
  return isCommand || trimmed.length > MAX_CHARS || tokenize(trimmed).length < MIN_WORDS
}

const pairs = (list: readonly Pair[]): string => list.map(p => `${p.heard} → ${p.meant}`).join(', ')

export const register: Register = (on, _options) => {
  let last: Prev | null = null

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'dictation',
        description: 'Speech-to-text repair: status, on, off, list, add heard=meant, rm heard',
        argumentHint: '[on|off|list|add heard=meant|rm heard]',
      })
    } catch {
    }
    return next(e)
  })

  on('command.run', { command: 'dictation' }, async ($, e) => {
    const out = runCommand(e.args ?? '', await load($), await $.clock.now())
    await save($, out.state)
    return { text: out.text }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOwn(e.origin)) return next(e)

    const state = await load($)
    if (!state.enabled || isSkipped(e.text)) return next(e)

    const text = e.text
    const now = await $.clock.now()

    const taught = learnFromPrompt(last, text, TERMS)
    let dict = state.dict
    taught.unlearn.forEach(heard => {
      dict = rejectHeard(dict, heard)
    })
    taught.learn.forEach(p => {
      dict = addLearned(dict, p, 'learned', now)
    })
    if (taught.learn.length + taught.unlearn.length > 0) {
      await save($, { ...state, dict })
      const said = [
        taught.learn.length > 0 ? `learned ${pairs(taught.learn)}` : '',
        taught.unlearn.length > 0 ? `dropped ${taught.unlearn.join(', ')}` : '',
      ].filter(s => s !== '')
      $.ui.toast(`✎ dictation-repair: ${said.join('; ')}`)
    }

    const cleaned = cleanup(text)
    const spoken = spokenForms(cleaned.text)
    const working = spoken.text
    const notes = [
      cleaned.removed.length > 0 ? `removed ${cleaned.removed.join(', ')}` : '',
      spoken.changed.length > 0 ? `respelled ${spoken.changed.join(', ')}` : '',
    ].filter(s => s !== '')
    const sendCleaned = () => {
      if (working === text) return next(e)
      $.ui.toast(`✎ dictation-repair: ${notes.join('; ')}`)
      return next({ ...e, text: working })
    }

    const entries = resolveEntries(dict)
    const hits = scan(working, entries, TERMS)
    last = { original: text, sent: working, applied: [] }
    if (hits.length === 0) return sendCleaned()

    const request: Request = buildRequest(working, hits)
    let reply: string | undefined
    try {
      const r = await $.model.complete({
        model: MODEL,
        system: request.system,
        prompt: request.prompt,
        maxTokens: BASE_TOKENS + Math.ceil(working.length / 2),
        timeoutMs: TIMEOUT_MS,
      })
      reply = r.isAnswered ? r.text : undefined
    } catch {
      reply = undefined
    }
    if (reply === undefined) return sendCleaned()

    const verdict = acceptReply(working, reply, TERMS, entries)
    if (!verdict.ok || verdict.pairs.length === 0) return sendCleaned()

    const known = new Set(entries.map(x => `${normalize(x.heard)}|${normalize(x.meant)}`))
    const terms = new Set(TERMS.map(t => t.toLowerCase()))
    const keep = verdict.pairs.filter(
      p => known.has(`${normalize(p.heard)}|${normalize(p.meant)}`) || terms.has(p.meant.toLowerCase()),
    )
    if (keep.length > 0) {
      keep.forEach(p => {
        dict = addLearned(dict, p, 'learned', now)
      })
      await save($, { ...state, dict })
    }

    last = { original: text, sent: verdict.text, applied: verdict.pairs }
    $.ui.toast(`✎ dictation-repair: ${[pairs(verdict.pairs), ...notes].join('; ')}`)
    return next({ ...e, text: verdict.text })
  })
}
