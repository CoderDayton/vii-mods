import type { Hook, ModelCompleteResult, PromptOrigin, Register } from 'claude-code'

import { applyVerdict } from '../src/apply'
import { runRules } from '../src/commands'
import { DIR_ARGV, isPaused, pauseArgv, readLedger, updateLedger } from '../src/disk'
import type { Disk } from '../src/disk'
import { mightCorrect } from '../src/gate'
import { buildJudgeRequest, parseVerdict } from '../src/judge'
import { readOptions } from '../src/options'
import type { Config } from '../src/options'
import { MAX_QUOTE } from '../src/rules'
import { ruleSection } from '../src/section'
import { oneLine } from '../src/text'

type Engine = Parameters<Hook<'prompt.submit'>>[0]

// The parts of `$` the judge needs once the hook that started it has returned.
type Io = {
  disk: () => Promise<Disk>
  root: () => Promise<string>
  now: () => Promise<number>
  toast: (text: string) => void
  complete: (request: { system: string; prompt: string }) => Promise<ModelCompleteResult>
}

const SECTION_ID = 'correction-ledger:rules'
const JUDGE_TOKENS = 400
const DIR_MS = 5000

let dir: Promise<string> | null = null

// The disk is built from `$` of whichever hook needs it; the directory is resolved once.
const diskOf = async ($: Engine): Promise<Disk> => {
  dir ??= $.process.run(DIR_ARGV, { timeoutMs: DIR_MS }).then(r => {
    const found = r.stdout.trim()
    if (found === '') throw new Error('correction-ledger: no directory')
    return found
  })
  const resolved = await dir.catch((error: unknown) => {
    dir = null
    throw error
  })
  return {
    dir: resolved,
    read: async path => {
      try {
        return await $.fs.read(path)
      } catch {
        return null
      }
    },
    exists: path => $.fs.exists(path),
    run: async (argv, init) => {
      const r = await $.process.run(argv, init)
      return { exitCode: r.exitCode, stdout: r.stdout }
    },
  }
}

// The project a session belongs to: its git repository's root (the main working tree's, for a worktree), so a
// session started in a subfolder shares the repository's rules; outside git, the folder it started in.
const projectOf = async ($: Engine): Promise<string> => (await $.session.repo())?.root ?? (await $.session.root())

const ioFrom = ($: Engine, config: Config, disk: () => Promise<Disk>): Io => ({
  disk,
  root: () => projectOf($),
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

// One model call turns a possible correction into a verdict. The verdict is applied to the ledger as
// it stands when the call returns, so rules other sessions saved meanwhile are kept.
const judge = async (io: Io, config: Config, text: string, last: string): Promise<void> => {
  const disk = await io.disk()
  const root = await io.root()
  const before = await readLedger(disk, root)
  const reply = await io.complete(buildJudgeRequest({ text, last, rules: before.rules }))
  if (!reply.isAnswered) return
  const verdict = parseVerdict(reply.text, before.rules, text)
  if (verdict.kind === 'none') return
  const when = { quote: oneLine(text, MAX_QUOTE), now: await io.now(), max: config.maxRules }
  try {
    const note = await updateLedger(disk, root, l => {
      const applied = applyVerdict(l, verdict, when)
      return { ledger: applied.ledger, result: applied.note }
    })
    if (note !== null) io.toast(note)
  } catch {
    io.toast('correction-ledger: a correction could not be saved')
  }
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  let io: Io | null = null
  let queue: Promise<void> = Promise.resolve()

  on('session.start', async ($, e, next) => {
    io = ioFrom($, config, () => diskOf($))
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
    if (io !== null && isUsers(e.origin) && mightCorrect(e.text) && !(await isPaused(await diskOf($)))) {
      const judging = io
      const last = await lastAnswer($)
      queue = queue.then(() => judge(judging, config, e.text, last)).catch(() => undefined)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Read from the file every turn: rules another session saved arrive without a restart.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const disk = await diskOf($)
      if (await isPaused(disk)) return composed
      const text = ruleSection((await readLedger(disk, await projectOf($))).rules)
      return text === null ? composed : { sections: [...composed.sections, { id: SECTION_ID, text, scope: 'session' }] }
    } catch {
      return composed
    }
  })

  on('command.run', { command: 'rules' }, async ($, e) => {
    try {
      const disk = await diskOf($)
      const enabled = !(await isPaused(disk))
      const now = await $.clock.now()
      const out = await updateLedger(disk, await projectOf($), l => {
        const ran = runRules(e.args ?? '', { ledger: l, enabled, now, max: config.maxRules })
        return { ledger: ran.ledger ?? l, result: ran }
      })
      if (out.enabled !== undefined) await disk.run(pauseArgv(disk.dir, !out.enabled))
      return { text: out.text }
    } catch {
      return { text: 'correction-ledger: the ledger could not be read or written' }
    }
  })
}
