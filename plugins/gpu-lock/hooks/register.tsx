import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import { runCommand } from '../src/commands'
import { createGuard } from '../src/guard'
import type { Io } from '../src/io'
import { readOptions } from '../src/options'
import { createRuntime } from '../src/runtime'
import type { Runtime } from '../src/runtime'
import { bandView, paneView } from '../src/ui'
import { bandModel, paneModel } from '../src/view'

const snapshotAtom = atom({ plugin: 'gpu-lock', key: 'snapshot' } as const, null)
const logAtom = atom({ plugin: 'gpu-lock', key: 'log' } as const, [])
const waitingAtom = atom({ plugin: 'gpu-lock', key: 'waiting' } as const, null)
const enabledAtom = atom({ plugin: 'gpu-lock', key: 'enabled' } as const, true)

const PANE_ID = 'gpu-lock'
const DEFAULT_COLUMNS = 100
const PANE_CHROME_ROWS = 6

const RULES =
  'GPU lock (gpu-lock plugin): this machine runs one CUDA job at a time. A Bash command that uses the GPU is run under a lock and checked against free GPU memory first. If it is refused, wait for the running job to end; do not start a second one. To say how much GPU memory a command needs, end it with `# gpu 8g`. To mark a command that does not use the GPU, end it with `# nogpu`.'

let io: Io | null = null
let rt: Runtime | null = null

const startHook: Hook<'session.start'> = async ($, e, next) => {
    io = {
      process: { run: (argv, init) => $.process.run(argv, init) },
      fs: { read: path => $.fs.read(path), exists: path => $.fs.exists(path) },
      clock: { now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn) },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd() },
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
      ui: { toast: text => $.ui.toast(text), status: text => $.ui.status(text) },
      state: {
        snapshot: { get: () => read($, snapshotAtom), set: async fn => void (await update($, snapshotAtom, fn)) },
        log: { get: () => read($, logAtom), set: async fn => void (await update($, logAtom, fn)) },
        waiting: { get: () => read($, waitingAtom), set: async fn => void (await update($, waitingAtom, fn)) },
        enabled: { get: () => read($, enabledAtom), set: async fn => void (await update($, enabledAtom, fn)) },
      },
    }
    try {
      await $.command.register({
        name: 'gpu',
        description: 'GPU lock: pane, status, on, off, check <command>',
        argumentHint: '[status|on|off|check <command>]',
      })
    } catch {
      $.ui.toast('gpu-lock: the /gpu command could not be registered; the lock still works')
    }
    await rt?.start(io, e.isInteractive)
    return next(e)
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  const runtime = createRuntime(config)
  const guard = createGuard(config, runtime)
  rt = runtime

  on('session.start', startHook)

  on('session.end', async (_$, e, next) => {
    if (io !== null && e.reason === 'clear') await runtime.resetSession(io)
    else runtime.stopPolling()
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, (_$, e, next) => {
    if (io === null) return next(e)
    return guard(io, {
      command: e.command,
      agentId: e.agentId,
      background: e.run_in_background === true,
      run: command => next({ ...e, command }),
    })
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabledAtom))) return composed
    return { sections: [...composed.sections, { id: 'gpu-lock:rules', text: RULES, scope: 'session' }] }
  })

  on('command.run', { command: 'gpu' }, async ($, e) => {
    if (io === null) return { text: 'gpu-lock has not started yet.' }
    const args = e.args ?? ''
    const word = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
    const enabled = await read($, enabledAtom)
    const wantsFresh = enabled && (word === '' || word === 'pane' || word === 'status')
    const out = runCommand(args, {
      config,
      snapshot: wantsFresh ? await runtime.refresh(io) : await read($, snapshotAtom),
      enabled,
      now: await $.clock.now(),
      session: await $.session.id(),
    })
    if (out.action === 'on') await runtime.setEnabled(io, true)
    if (out.action === 'off') await runtime.setEnabled(io, false)
    if (out.action === 'pane') await $.ui.open({ id: PANE_ID, title: 'GPU lock' })
    return { text: out.text }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const model = bandModel({
      snapshot: await read($, snapshotAtom),
      waiting: await read($, waitingAtom),
      enabled: await read($, enabledAtom),
      mode: config.band,
      now: await $.clock.now(),
      session: await $.session.id(),
      width: e.viewport?.columns ?? DEFAULT_COLUMNS,
    })
    if (model === null) return next(e)
    return bandView($.ui.resolve(e), model)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const enabled = await read($, enabledAtom)
    const model = paneModel({
      snapshot: await read($, snapshotAtom),
      waiting: await read($, waitingAtom),
      enabled,
      log: await read($, logAtom),
      bad: config.bad,
      now: await $.clock.now(),
      session: await $.session.id(),
    })
    const room = Math.max(1, (e.viewport?.rows ?? 24) - PANE_CHROME_ROWS)
    return paneView($.ui.resolve(e), { ...model, log: model.log.slice(0, room) }, {
      onRefresh: () => {
        if (io !== null) void runtime.refresh(io)
      },
      onToggle: () => {
        if (io !== null) void runtime.setEnabled(io, !enabled)
      },
    })
  })
}
