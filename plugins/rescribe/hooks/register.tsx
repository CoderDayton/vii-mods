import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { findChord } from '../src/chord'
import { diffPairs } from '../src/diff'
import { MAX_DRAFT, acceptEnhanced, buildRequest } from '../src/enhance'
import { readOptions } from '../src/options'
import { ACTION, idleView, reviewView, withBelow } from '../src/ui'
import { reviewModel } from '../src/view'

const reviewAtom = atom({ plugin: 'rescribe', key: 'review' } as const, null)

const BASE_TOKENS = 512

export const register: Register = (on, options) => {
  const config = readOptions(options)
  let isBusy = false
  let chord: string | null | undefined

  on('prompt.edit', async ($, e, next) => {
    const isTextChange = e.inputText !== '' || e.end > e.start
    if (isTextChange && (await read($, reviewAtom)) !== null) await update($, reviewAtom, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, reviewAtom)) !== null) await update($, reviewAtom, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const below = await next(e)
    const els = $.ui.resolve(e)
    const review = await read($, reviewAtom)

    if (chord === undefined) {
      try {
        const custom = await $.env.get('CLAUDE_CONFIG_DIR')
        const home = await $.env.get('HOME')
        const dir = custom ?? (home === undefined ? undefined : `${home}/.claude`)
        chord = dir === undefined ? null : findChord(String(await $.fs.read(`${dir}/keybindings.json`)), ACTION)
      } catch {
        chord = null
      }
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

        if (enhanced === null) $.ui.toast('rescribe: could not enhance this prompt')
        else if (enhanced === text.trim()) $.ui.toast('rescribe: nothing to improve')
        else if ((await $.prompt.read()).text !== text) $.ui.toast('rescribe: the draft changed, so nothing was applied')
        else await update($, reviewAtom, () => ({ original: text, fixed: enhanced, pairs: diffPairs(text, enhanced) }))
      } catch {
        $.ui.toast('rescribe: could not enhance this prompt')
      } finally {
        isBusy = false
      }
    }

    if (review === null) return withBelow(els, below, idleView(els, enhance, chord))

    const model = reviewModel(review)

    const take = async (): Promise<boolean> => {
      if ((await read($, reviewAtom)) === null) return false
      await update($, reviewAtom, () => null)
      return true
    }

    const apply = async () => {
      if (!(await take())) return
      if ((await $.prompt.read()).text !== review.original) {
        $.ui.toast('rescribe: the draft changed, so nothing was applied')
        return
      }
      const filled = await $.prompt.fill({ text: review.fixed })
      if (filled.isFilled) return
      await update($, reviewAtom, () => review)
      $.ui.toast('rescribe: the prompt box is busy, so the text could not be put in it')
    }

    const dismiss = async () => {
      await take()
    }

    return withBelow(els, below, reviewView(els, model, { onApply: apply, onDismiss: dismiss }, chord))
  })
}
