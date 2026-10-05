import type { ToolCallResult } from 'claude-code'

import { classify } from './classify'
import { clean } from './format'
import type { Io } from './io'
import { ownerPathOf } from './lock'
import { acquiredNote, refusedBusy, refusedMemory, whoLabel } from './messages'
import type { Config } from './options'
import { decide } from './policy'
import type { Runtime } from './runtime'
import { ensureLock, readGpu, readLock } from './sys'
import { wrap } from './wrap'

const LOST_MARK = 'another job took the GPU lock first'
const LOG_CMD_CHARS = 120
const TOAST_CMD_CHARS = 50

export type Guarded = {
  command: string
  agentId: string | undefined
  background: boolean
  run: (command: string) => Promise<ToolCallResult>
}

export const createGuard = (config: Config, rt: Runtime) => {
  const options = { extra: config.extra, skip: config.skip, lockPath: config.lockPath }

  const refuse = async (io: Io, command: string, now: number, note: string, toast: string) => {
    await rt.record(io, { at: now, kind: 'refused', cmd: clean(command, LOG_CMD_CHARS), ms: null, note })
    io.ui.toast(toast)
  }

  const lockBroken = (io: Io, reason: string) => {
    rt.setFault(reason)
    if (rt.takeFaultNotice()) io.ui.toast(`gpu-lock is off here: ${reason}`)
  }

  const runWrapped = async (io: Io, g: Guarded, wrapped: string, queued: boolean, now: number) => {
    if (queued) await io.state.waiting.set(() => ({ cmd: clean(g.command, LOG_CMD_CHARS), since: now }))
    try {
      return await g.run(wrapped)
    } finally {
      if (queued) await io.state.waiting.set(() => null)
    }
  }

  return async (io: Io, g: Guarded): Promise<ToolCallResult> => {
    if (!(await io.state.enabled.get())) return g.run(g.command)
    const verdict = classify(g.command, options)
    if (!verdict.gpu) return g.run(g.command)

    const failure = await ensureLock(io, config.lockPath)
    if (failure !== null) {
      lockBroken(io, failure)
      return g.run(g.command)
    }
    rt.setFault(null)

    const [lock, gpu, now, session, cwd] = await Promise.all([
      readLock(io, config.lockPath),
      readGpu(io),
      io.clock.now(),
      io.session.id(),
      io.session.cwd(),
    ])
    await rt.publish(io, { at: now, lock, gpu })
    const d = decide({ verdict, lock, gpu, minFreeMiB: config.minFreeMiB, waitSeconds: config.waitSeconds })
    const short = clean(g.command, TOAST_CMD_CHARS)

    if (d.kind === 'pass') return g.run(g.command)
    if (d.kind === 'refuse-busy') {
      await refuse(io, g.command, now, `locked by ${whoLabel(d.holder, session)}`, `GPU locked · refused: ${short}`)
      return { deny: refusedBusy(d.holder, now, session, gpu) }
    }
    if (d.kind === 'refuse-memory') {
      await refuse(io, g.command, now, 'not enough free memory', `GPU memory low · refused: ${short}`)
      return { deny: refusedMemory(d.needMiB, d.freeMiB, d.totalMiB, gpu) }
    }

    const wrapped = wrap(g.command, {
      lockPath: config.lockPath,
      ownerPath: ownerPathOf(config.lockPath),
      waitSeconds: d.waits ? config.waitSeconds : 0,
      owner: { session, agent: g.agentId ?? null, cmd: g.command, cwd, why: verdict.why, needMiB: verdict.needMiB },
    })
    const ran = await runWrapped(io, g, wrapped, d.waits, now)
    if (ran.deny !== undefined) return ran

    const ended = await io.clock.now()
    if (ran.isError === true && (ran.text ?? '').includes(LOST_MARK)) {
      const why = 'another job took the lock first'
      await refuse(io, g.command, ended, why, `GPU locked · refused: ${short} (${why})`)
      rt.refreshQuietly(io)
      return ran
    }
    await rt.record(io, {
      at: ended,
      kind: ran.isError === true ? 'failed' : 'ran',
      cmd: clean(g.command, LOG_CMD_CHARS),
      ms: g.background ? null : ended - now,
      note: g.background ? 'background' : '',
    })
    if (g.background) rt.backgroundStarted(ended)
    rt.refreshQuietly(io)
    const note = acquiredNote({ freeMiB: d.freeMiB, totalMiB: d.totalMiB, reading: gpu, background: g.background })
    return { ...ran, context: [...(ran.context ?? []), note] } as ToolCallResult
  }
}
