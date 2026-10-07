import type { Hook, ModelCompleteResult, PromptOrigin, Register } from 'claude-code'

import { applyVerdict } from '../src/apply'
import { runRules } from '../src/commands'
import { mightCorrect } from '../src/gate'
import { buildJudgeRequest, parseVerdict } from '../src/judge'
import { readOptions } from '../src/options'
import type { Config } from '../src/options'
import { MAX_QUOTE, parseLedger } from '../src/rules'
import type { Ledger } from '../src/rules'
import { ruleSection } from '../src/section'
import { oneLine } from '../src/text'

type Engine = Parameters<Hook<'prompt.submit'>>[0]

// The parts of `$` the judge needs once the hook that started it has returned.
type Io = {
  store: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
  cwd: () => Promise<string>
  now: () => Promise<number>
  toast: (text: string) => void
  complete: (request: { system: string; prompt: string }) => Promise<ModelCompleteResult>
}

const SECTION_ID = 'correction-ledger:rules'
const ENABLED_KEY = 'enabled'
const JUDGE_TOKENS = 400

const ledgerKey = (cwd: string): string => `ledger:${cwd}`

const ioFrom = ($: Engine, config: Config): Io => ({
  store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
  cwd: () => $.session.cwd(),
  now: () => $.clock.now(),
  toast: text => $.ui.toast(text),
  complete: request =>
    $.model.complete({
      model: config.model,
      effort: 'low',
      system: request.system,
      prompt: request.prompt,
      maxTokens: JUDGE_TOKENS,
      timeoutMs: config.timeoutMs,
    }),
})

const isEnabled = async ($: Engine): Promise<boolean> => (await $.store.get(ENABLED_KEY)) !== false

type Get = (key: string) => Promise<unknown>

const readLedger = async (get: Get, cwd: string): Promise<Ledger> => parseLedger(await get(ledgerKey(cwd)))

// The user's own words, from the composer or their phone; not a scheduled run or a notification.
const isUsers = (origin: PromptOrigin): boolean => origin.kind === 'composer' || origin.kind === 'bridge'

// Captured while the hook runs: by the time the judge starts the transcript has moved on.
const lastAnswer = async ($: Engine): Promise<string> => {
  try {
    const rows = await $.session.messages()
    return [...rows].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')?.text ?? ''
  } catch {
    return ''
  }
}

// One model call turns a possible correction into a verdict; the ledger is read again before the verdict is applied.
const judge = async (io: Io, config: Config, text: string, last: string): Promise<void> => {
  const cwd = await io.cwd()
  const before = await readLedger(io.store.get, cwd)
  const reply = await io.complete(buildJudgeRequest({ text, last, rules: before.rules }))
  if (!reply.isAnswered) return
  const verdict = parseVerdict(reply.text, before.rules, text)
  const current = await readLedger(io.store.get, cwd)
  const applied = applyVerdict(current, verdict, { quote: oneLine(text, MAX_QUOTE), now: await io.now(), max: config.maxRules })
  if (applied.ledger !== current) await io.store.set(ledgerKey(cwd), applied.ledger)
  if (applied.note !== null) io.toast(applied.note)
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  let io: Io | null = null
  let queue: Promise<void> = Promise.resolve()

  on('session.start', async ($, e, next) => {
    io = ioFrom($, config)
    try {
      await $.command.register({
        name: 'rules',
        description: 'Correction ledger: list, add, rm, clear, off, on',
        argumentHint: '[add <rule>|rm <number>|clear|off|on]',
        immediate: true,
      })
    } catch {
      $.ui.toast('correction-ledger: the /rules command could not be registered; the ledger still works')
    }
    return next(e)
  })

  // The prompt is never held up: the verdict comes later, one at a time, and a failure leaves the ledger as it was.
  on('prompt.submit', async ($, e, next) => {
    if (io !== null && isUsers(e.origin) && mightCorrect(e.text) && (await isEnabled($))) {
      const judging = io
      const last = await lastAnswer($)
      queue = queue.then(() => judge(judging, config, e.text, last)).catch(() => undefined)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await isEnabled($))) return composed
    const text = ruleSection((await readLedger(key => $.store.get(key), await $.session.cwd())).rules)
    return text === null ? composed : { sections: [...composed.sections, { id: SECTION_ID, text, scope: 'session' }] }
  })

  on('command.run', { command: 'rules' }, async ($, e) => {
    const cwd = await $.session.cwd()
    const out = runRules(e.args ?? '', {
      ledger: await readLedger(key => $.store.get(key), cwd),
      enabled: await isEnabled($),
      now: await $.clock.now(),
      max: config.maxRules,
    })
    if (out.ledger !== undefined) await $.store.set(ledgerKey(cwd), out.ledger)
    if (out.enabled !== undefined) await $.store.set(ENABLED_KEY, out.enabled)
    return { text: out.text }
  })
}
