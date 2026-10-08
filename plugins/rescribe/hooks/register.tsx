import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import { findChord } from '../src/chord'
import { diffPairs } from '../src/diff'
import { MAX_DRAFT, acceptEnhanced, buildRequest, refusalReason } from '../src/enhance'
import { appendArgv, buildEntry, hasAttachments, historyPathOf, learnShape, tailArgv } from '../src/history'
import { readOptions } from '../src/options'
import { ACTION, idleView, paneView, reviewView, withBelow } from '../src/ui'
import { paneRows, reviewModel } from '../src/view'

const reviewAtom = atom({ plugin: 'rescribe', key: 'review' } as const, null)

const BASE_TOKENS = 512
const PANE_ID = 'rescribe-diff'
const HISTORY_MS = 5000

type Engine = Parameters<Hook<'prompt.submit'>>[0]

type Saved = 'saved' | 'attachments' | 'unrecognised' | 'failed'

const APPLIED: Record<Saved, string> = {
  saved: 'rescribe: applied · ↑ brings back your original',
  attachments: 'rescribe: applied (your original has pasted text or an image, so it is not in history)',
  unrecognised: 'rescribe: applied (the history file layout was not recognised, so your original is not in history)',
  failed: 'rescribe: applied (could not save your original to history)',
}

// Where Claude Code keeps its settings and history.
const configDir = async ($: Engine): Promise<string | undefined> => {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  return custom ?? (home === undefined ? undefined : `${home}/.claude`)
}

// Adds the original draft to the Up-arrow history, in the layout the history file has now.
const saveOriginal = async ($: Engine, original: string): Promise<Saved> => {
  if (hasAttachments(original)) return 'attachments'
  try {
    const dir = await configDir($)
    if (dir === undefined) return 'failed'
    const path = historyPathOf(dir)
    const tail = await $.process.run(tailArgv(path), { timeoutMs: HISTORY_MS })
    if (tail.exitCode !== 0) return 'failed'
    const shape = learnShape(tail.stdout)
    if (shape === null) return 'unrecognised'
    const line = buildEntry(shape, {
      text: original,
      now: await $.clock.now(),
      project: await $.session.root(),
      sessionId: await $.session.id(),
    })
    const written = await $.process.run(appendArgv(path, line), { timeoutMs: HISTORY_MS })
    return written.exitCode === 0 ? 'saved' : 'failed'
  } catch {
    return 'failed'
  }
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  let isBusy = false
  let isPaneUp = false
  let chord: string | null | undefined

  on('prompt.edit', async ($, e, next) => {
    const isTextChange = e.inputText !== '' || e.end > e.start
    if (isTextChange && (await read($, reviewAtom)) !== null) {
      await update($, reviewAtom, () => null)
      if (isPaneUp) {
        isPaneUp = false
        await $.ui.close({ id: PANE_ID })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, reviewAtom)) !== null) {
      await update($, reviewAtom, () => null)
      if (isPaneUp) {
        isPaneUp = false
        await $.ui.close({ id: PANE_ID })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID && e.origin.kind === 'person' && isPaneUp) {
      isPaneUp = false
      await update($, reviewAtom, r => (r === null ? r : { ...r }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const review = await read($, reviewAtom)
    return paneView($.ui.resolve(e), review === null ? null : reviewModel(review))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const below = await next(e)
    const els = $.ui.resolve(e)
    const review = await read($, reviewAtom)

    if (chord === undefined) {
      try {
        const dir = await configDir($)
        chord = dir === undefined ? null : findChord(String(await $.fs.read(`${dir}/keybindings.json`)), ACTION)
      } catch {
        chord = null
      }
    }

    // Opens the diff in a pane; false when the surface cannot place one, and the band shows the diff instead.
    const showInPane = async (m: ReturnType<typeof reviewModel>): Promise<boolean> => {
      try {
        const opened = await $.ui.open({ id: PANE_ID, title: 'Enhance Prompt', rows: paneRows(m.rows) })
        if (opened.isPlaced) return true
        await $.ui.close({ id: PANE_ID })
      } catch {
        return false
      }
      return false
    }

    const enhance = async () => {
      if (isBusy) {
        $.ui.toast('rescribe: already enhancing')
        return
      }
      isBusy = true
      try {
        const { text } = await $.prompt.read()
        if (text.trim() === '') return
        if (text.length > MAX_DRAFT) {
          $.ui.toast('rescribe: the draft is too long to enhance')
          return
        }

        const request = buildRequest(text)
        $.ui.toast('rescribe: enhancing…')
        const reply = await $.model.complete({
          model: config.model,
          effort: config.effort,
          system: request.system,
          prompt: request.prompt,
          maxTokens: BASE_TOKENS + text.length,
          timeoutMs: config.timeoutMs,
        })
        const enhanced = reply.isAnswered ? acceptEnhanced(text, reply.text) : null

        if (enhanced === null) {
          const why = reply.isAnswered
            ? refusalReason(text, reply.text)
            : `the model did not answer (${reply.reason})`
          $.ui.toast(`rescribe: could not enhance this prompt: ${why}`)
        } else if (enhanced === text.trim()) $.ui.toast('rescribe: nothing to improve')
        else if ((await $.prompt.read()).text !== text) $.ui.toast('rescribe: the draft changed, so nothing was applied')
        else {
          const review = { original: text, fixed: enhanced, pairs: diffPairs(text, enhanced) }
          if (config.autoAccept && (await $.prompt.fill({ text: enhanced })).isFilled) {
            $.ui.toast(APPLIED[await saveOriginal($, text)])
            return
          }
          if (config.autoAccept) $.ui.toast('rescribe: the prompt box is busy, so the text could not be put in it')
          isPaneUp = await showInPane(reviewModel(review))
          await update($, reviewAtom, () => review)
        }
      } catch {
        $.ui.toast('rescribe: could not enhance this prompt')
      } finally {
        isBusy = false
      }
    }

    if (review === null) return withBelow(els, below, idleView(els, enhance))

    const model = reviewModel(review)

    const take = async (): Promise<boolean> => {
      if ((await read($, reviewAtom)) === null) return false
      await update($, reviewAtom, () => null)
      if (isPaneUp) {
        isPaneUp = false
        await $.ui.close({ id: PANE_ID })
      }
      return true
    }

    const apply = async () => {
      if (!(await take())) return
      if ((await $.prompt.read()).text !== review.original) {
        $.ui.toast('rescribe: the draft changed, so nothing was applied')
        return
      }
      const filled = await $.prompt.fill({ text: review.fixed })
      if (filled.isFilled) {
        $.ui.toast(APPLIED[await saveOriginal($, review.original)])
        return
      }
      await update($, reviewAtom, () => review)
      $.ui.toast('rescribe: the prompt box is busy, so the text could not be put in it')
    }

    const dismiss = async () => {
      await take()
    }

    return withBelow(els, below, reviewView(els, model, { onApply: apply, onDismiss: dismiss }, chord, !isPaneUp))
  })
}
