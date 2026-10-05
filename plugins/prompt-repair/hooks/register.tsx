import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { cleanup } from '../src/cleanup'
import { runCommand } from '../src/commands'
import type { Mode, State } from '../src/commands'
import { addLearned, normalizeDictionary, rejectHeard, resolveEntries } from '../src/dictionary'
import { TERMS } from '../src/glossary'
import { learnFromPrompt } from '../src/learn'
import type { Prev } from '../src/learn'
import { acceptFix, buildRequest, diffPairs } from '../src/repair'
import type { Request } from '../src/repair'
import { scan } from '../src/scan'
import { spokenForms } from '../src/spoken'
import { normalize, tokenize } from '../src/text'
import type { Pair } from '../src/types'
import { reviewView } from '../src/ui'
import { describePairs, reviewModel } from '../src/view'

const reviewAtom = atom({ plugin: 'prompt-repair', key: 'review' } as const, null)

const MODEL = 'haiku'
const TIMEOUT_MS = 8000
const MAX_CHARS = 4000
const MIN_WORDS = 2
const BASE_TOKENS = 64
const DEFAULT_COLUMNS = 80
const WAITING = 'prompt-repair is waiting for your choice above the prompt.'

const KEY_DICTIONARY = 'dictionary'
const KEY_ENABLED = 'enabled'
const KEY_MODE = 'mode'

type Store = {
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
}

const load = async ($: Store): Promise<State> => ({
  dict: normalizeDictionary(await $.store.get(KEY_DICTIONARY)),
  enabled: (await $.store.get(KEY_ENABLED)) !== false,
  mode: ((await $.store.get(KEY_MODE)) === 'auto' ? 'auto' : 'review') satisfies Mode,
})

const save = async ($: Store, state: State): Promise<void> => {
  await $.store.set(KEY_DICTIONARY, state.dict)
  await $.store.set(KEY_ENABLED, state.enabled)
  await $.store.set(KEY_MODE, state.mode)
}

const isOwn = (origin: { kind: string } | undefined): boolean =>
  origin === undefined || origin.kind === 'composer' || origin.kind === 'bridge'

const isSkipped = (text: string): boolean => {
  const trimmed = text.trim()
  const isCommand = trimmed.startsWith('/') || trimmed.startsWith('!')
  return isCommand || trimmed.length > MAX_CHARS || tokenize(trimmed).length < MIN_WORDS
}

export const register: Register = (on, _options) => {
  let last: Prev | null = null
  let skip: string | null = null

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'prompt-repair',
        description: 'Prompt repair: status, on, off, review, auto, list, add heard=meant, rm heard',
        argumentHint: '[on|off|review|auto|list|add heard=meant|rm heard]',
      })
    } catch {
      $.ui.toast('prompt-repair: the /prompt-repair command could not be registered; repairs still run')
    }
    return next(e)
  })

  on('command.run', { command: 'prompt-repair' }, async ($, e) => {
    const out = runCommand(e.args ?? '', await load($), await $.clock.now())
    await save($, out.state)
    return { text: out.text }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOwn(e.origin)) return next(e)

    const text = e.text
    if (skip !== null) {
      const isEdited = text.trim() === skip
      skip = null
      if (isEdited) return next(e)
    }

    const state = await load($)
    if (!state.enabled || isSkipped(text)) return next(e)

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
        taught.learn.length > 0 ? `learned ${describePairs(taught.learn)}` : '',
        taught.unlearn.length > 0 ? `dropped ${taught.unlearn.join(', ')}` : '',
      ].filter(s => s !== '')
      $.ui.toast(`✎ prompt-repair: ${said.join('; ')}`)
    }

    const cleaned = cleanup(text)
    const spoken = spokenForms(cleaned.text)
    const working = spoken.text
    const notes = [
      cleaned.removed.length > 0 ? `removed ${cleaned.removed.join(', ')}` : '',
      spoken.changed.length > 0 ? `respelled ${spoken.changed.join(', ')}` : '',
    ].filter(s => s !== '')

    const entries = resolveEntries(dict)
    const hits = scan(working, entries, TERMS)
    last = { original: text, sent: working, applied: [] }

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

    const verdict = reply === undefined ? undefined : acceptFix(working, reply)
    const fix = verdict !== undefined && verdict.ok && verdict.pairs.length > 0 ? verdict : undefined
    const candidate = fix === undefined ? working : fix.text
    if (candidate === text) return next(e)

    const known = new Set(entries.map(x => `${normalize(x.heard)}|${normalize(x.meant)}`))
    const terms = new Set(TERMS.map(t => t.toLowerCase()))
    const learn: Pair[] = (fix?.pairs ?? []).filter(
      p => known.has(`${normalize(p.heard)}|${normalize(p.meant)}`) || terms.has(p.meant.toLowerCase()),
    )
    last = { original: text, sent: candidate, applied: fix?.pairs ?? [] }

    const isReviewed = state.mode === 'review' && e.origin?.kind === 'composer'
    if (isReviewed) {
      await update($, reviewAtom, () => ({ original: text, fixed: candidate, pairs: diffPairs(text, candidate), learn }))
      return { drop: WAITING }
    }

    if (learn.length > 0) {
      learn.forEach(p => {
        dict = addLearned(dict, p, 'learned', now)
      })
      await save($, { ...state, dict })
    }
    const said = [fix === undefined ? '' : describePairs(fix.pairs), ...notes].filter(s => s !== '')
    $.ui.toast(`✎ prompt-repair: ${said.join('; ')}`)
    return next({ ...e, text: candidate })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const review = await read($, reviewAtom)
    if (review === null || e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const model = reviewModel(review, e.props.bodyColumns ?? DEFAULT_COLUMNS)

    const take = async (): Promise<boolean> => {
      if ((await read($, reviewAtom)) === null) return false
      await update($, reviewAtom, () => null)
      return true
    }

    const accept = async () => {
      if (!(await take())) return
      if (review.learn.length > 0) {
        const state = await load($)
        const at = await $.clock.now()
        let dict = state.dict
        review.learn.forEach(p => {
          dict = addLearned(dict, p, 'learned', at)
        })
        await save($, { ...state, dict })
      }
      await $.prompt.submit({ text: review.fixed, asUser: true })
    }

    const original = async () => {
      if (!(await take())) return
      last = { original: review.original, sent: review.original, applied: [] }
      await $.prompt.submit({ text: review.original, asUser: true })
    }

    const edit = async () => {
      if (!(await take())) return
      skip = review.fixed.trim()
      const filled = await $.prompt.fill({ text: review.fixed })
      if (filled.isFilled) return
      skip = null
      await update($, reviewAtom, () => review)
      $.ui.toast('prompt-repair: the prompt box is busy, so the fix could not be put in it')
    }

    const auto = async () => {
      await $.store.set(KEY_MODE, 'auto')
      await accept()
    }

    return reviewView(els, model, { onAccept: accept, onEdit: edit, onOriginal: original, onAuto: auto })
  })
}
