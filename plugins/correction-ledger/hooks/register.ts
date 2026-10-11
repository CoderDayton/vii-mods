import type { Hook, ModelCompleteResult, PromptOrigin, Register } from 'claude-code'

import { applyVerdict } from '../src/apply'
import { runRules } from '../src/commands'
import { DIR_ARGV, isPaused, pauseArgv, readLedger, updateLedger } from '../src/disk'
import type { Disk } from '../src/disk'
import { mightCorrect } from '../src/gate'
import { buildJudgeRequest, parseVerdict } from '../src/judge'
import { readOptions } from '../src/options'
import type { Config } from '../src/options'
import { MAX_QUOTE, tick, touchRule } from '../src/rules'
import type { Ledger, Lives, Rule } from '../src/rules'
import { blockNote, remindNote, ruleSection } from '../src/section'
import { oneLine } from '../src/text'
import { fires, tokensOf } from '../src/trigger'
import type { Use } from '../src/trigger'

type Engine = Parameters<Hook<'prompt.submit'>>[0]

// The parts of `$` the judge needs once the hook that started it has returned.
type Io = {
  disk: () => Promise<Disk>
  root: () => Promise<string>
  now: () => Promise<number>
  toast: (text: string) => void
  // Tells the session which rules fire on a call, from the ledger as it now stands.
  arm: (ledger: Ledger) => void
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

const ioFrom = ($: Engine, config: Config, disk: () => Promise<Disk>, arm: (ledger: Ledger) => void): Io => ({
  disk,
  arm,
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

type Turn = { last: string; uses: Use[] }

// Claude's last answer and the calls it made since the user's prompt before this one. Captured while the
// hook runs: by the time the judge starts the transcript has moved on.
const lastTurn = async ($: Engine): Promise<Turn> => {
  try {
    const rows = await $.session.messages()
    const last = [...rows].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')?.text ?? ''
    const uses: Use[] = []
    let end = rows.length - 1
    while (end >= 0 && rows[end]?.role !== 'assistant') end--
    for (let i = end; i >= 0; i--) {
      const row = rows[i]
      if (row === undefined || (row.role === 'user' && row.text.trim() !== '')) break
      if (row.role === 'assistant') uses.unshift(...row.toolUses.map(u => ({ tool: u.tool, input: u.input })))
    }
    return { last, uses }
  } catch {
    return { last: '', uses: [] }
  }
}

// The arguments of a call, without the keys the engine adds beside them.
const argsOf = (e: object): Record<string, unknown> => {
  const args: Record<string, unknown> = { ...e }
  for (const key of ['tool', 'tool_use_id', 'agentId', 'consent']) delete args[key]
  return args
}

// Rules that fired count as seen today, so a rule in use does not run out.
const touch = async (io: Io, ids: readonly number[]): Promise<void> => {
  const ledger = await updateLedger(await io.disk(), await io.root(), l => {
    const next = ids.reduce(touchRule, l)
    return { ledger: next, result: next }
  })
  io.arm(ledger)
}

const expiredNote = (gone: readonly Rule[]): string =>
  gone.length === 1
    ? `correction-ledger: rule #${gone[0]?.id} expired: ${gone[0]?.text}`
    : `correction-ledger: ${gone.length} rules expired: ${gone.map(r => `#${r.id}`).join(', ')}`

// Counts today as a worked day and drops the rules that ran out. A project with no rules is left alone.
const age = async (io: Io, lives: Lives): Promise<void> => {
  try {
    const now = await io.now()
    const gone = await updateLedger(await io.disk(), await io.root(), l => {
      if (l.rules.length === 0) return { ledger: l, result: [] }
      const ticked = tick(l, now, lives)
      return { ledger: ticked.ledger, result: ticked.expired }
    })
    if (gone.length > 0) io.toast(expiredNote(gone))
  } catch {
    // A ledger that cannot be aged now is aged on a later prompt.
  }
}

// One model call turns a possible correction into a verdict. The verdict is applied to the ledger as
// it stands when the call returns, so rules other sessions saved meanwhile are kept.
const judge = async (io: Io, config: Config, text: string, turn: Turn): Promise<void> => {
  const disk = await io.disk()
  const root = await io.root()
  const before = await readLedger(disk, root)
  const reply = await io.complete(buildJudgeRequest({ text, last: turn.last, rules: before.rules, uses: turn.uses }))
  if (!reply.isAnswered) return
  const verdict = parseVerdict(reply.text, before.rules, text, turn.uses)
  if (verdict.kind === 'none') return
  const when = { quote: oneLine(text, MAX_QUOTE), now: await io.now(), max: config.maxRules }
  try {
    const done = await updateLedger(disk, root, l => {
      const applied = applyVerdict(l, verdict, when)
      return { ledger: applied.ledger, result: applied }
    })
    io.arm(done.ledger)
    if (done.note !== null) io.toast(done.note)
  } catch {
    io.toast('correction-ledger: a correction could not be saved')
  }
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  let io: Io | null = null
  let queue: Promise<void> = Promise.resolve()
  // The rules that fire on a call, as of the last read of the ledger, and its count of worked days then.
  let armed: Rule[] = []
  let armedDays = 0
  // Whether the ledger was paused when last looked at. A paused ledger arms nothing.
  let paused = false
  // Rules that reminded each loop this turn.
  const reminded = new Set<string>()
  // Calls a broken rule stopped that have not been made again, with the user's turn each was stopped in.
  // One runs when made again in that turn or the next; after that it is stopped afresh.
  const stopped = new Map<string, number>()
  let turn = 0

  const arm = (ledger: Ledger): void => {
    armed = paused ? [] : ledger.rules.filter(r => r.when !== undefined)
    armedDays = ledger.days
  }

  on('session.start', async ($, e, next) => {
    io = ioFrom($, config, () => diskOf($), arm)
    try {
      await $.command.register({
        name: 'rules',
        description: 'Correction ledger: list, add, keep, rm, clear, off, on',
        argumentHint: '[add <rule>|keep <number>|rm <number>|clear|off|on]',
        immediate: true,
      })
    } catch {
      $.ui.toast('correction-ledger: the /rules command could not be registered; the ledger still works')
    }
    return next(e)
  })

  // Rules age on the user's own prompts. The model is never waited for: the verdict comes later, one at a
  // time, and a failure leaves the ledger as it was. A prompt that may repeat a rule is judged before the
  // rules age, so a rule said again on the day it runs out gets a strike.
  on('prompt.submit', async ($, e, next) => {
    reminded.clear()
    if (isUsers(e.origin)) {
      turn += 1
      for (const [key, at] of stopped) if (turn - at > 1) stopped.delete(key)
    }
    if (io !== null && isUsers(e.origin) && !(await isPaused(await diskOf($)))) {
      const judging = io
      if (mightCorrect(e.text)) {
        const before = await lastTurn($)
        queue = queue
          .then(() => judge(judging, config, e.text, before))
          .catch(() => undefined)
          .then(() => age(judging, config.lives))
      } else await age(judging, config.lives)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // A rule fires when Claude makes the call it names. One that was never broken reminds Claude after the
  // call, once a turn. One that was broken stops the call once; the same call made again runs.
  on('tool.call', async (_$, e, next) => {
    const named = armed.filter(r => r.when?.tool === e.tool)
    if (named.length === 0) return next(e)
    const tokens = tokensOf(argsOf(e))
    const hit = named.filter(r => r.when !== undefined && fires(r.when, e.tool, tokens))
    if (hit.length === 0) return next(e)

    const stale = hit.filter(r => r.seen < armedDays).map(r => r.id)
    if (stale.length > 0 && io !== null) {
      const touching = io
      armed = armed.map(r => (stale.includes(r.id) ? { ...r, seen: armedDays } : r))
      queue = queue.then(() => touch(touching, stale)).catch(() => undefined)
    }

    const broken = hit.filter(r => r.strikes > 0)
    const key = `${e.tool} ${[...tokens].join(' ')}`
    if (broken.length > 0 && !stopped.delete(key)) {
      stopped.set(key, turn)
      return { deny: blockNote(broken) }
    }

    const out = await next(e)
    const mark = (r: Rule): string => `${e.agentId ?? ''} ${r.id}`
    const fresh = hit.filter(r => !reminded.has(mark(r)))
    if (fresh.length === 0 || out.deny !== undefined || out.isError === true) return out
    for (const r of fresh) reminded.add(mark(r))
    return { ...out, context: [...(out.context ?? []), remindNote(fresh)] }
  })

  // Read from the file every turn: rules another session saved arrive without a restart.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const disk = await diskOf($)
      paused = await isPaused(disk)
      if (paused) {
        armed = []
        return composed
      }
      const ledger = await readLedger(disk, await projectOf($))
      arm(ledger)
      const text = ruleSection(ledger.rules)
      return text === null ? composed : { sections: [...composed.sections, { id: SECTION_ID, text, scope: 'session' }] }
    } catch {
      return composed
    }
  })

  on('command.run', { command: 'rules' }, async ($, e) => {
    try {
      const disk = await diskOf($)
      const enabled = !(await isPaused(disk))
      paused = !enabled
      const now = await $.clock.now()
      const out = await updateLedger(disk, await projectOf($), l => {
        const ran = runRules(e.args ?? '', { ledger: l, enabled, now, max: config.maxRules, lives: config.lives })
        return { ledger: ran.ledger ?? l, result: ran }
      })
      if (out.ledger !== undefined) arm(out.ledger)
      if (out.enabled !== undefined) {
        await disk.run(pauseArgv(disk.dir, !out.enabled))
        paused = !out.enabled
        if (paused) armed = []
      }
      return { text: out.text }
    } catch {
      return { text: 'correction-ledger: the ledger could not be read or written' }
    }
  })
}
