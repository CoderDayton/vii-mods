import type { Entry, Snapshot } from '../types'
import { appendSample, readSamples } from './histfile'
import { MIN_GAP_MS, needsTree, sampleOf } from './history'
import type { Io } from './io'
import type { Config } from './options'
import { newMemo, publishSnapshot } from './publish'
import { PS_ARGV, parseParents } from './procs'
import { ensureLock, takeSnapshot } from './sys'

const POLL_MS = 3000
const PS_TIMEOUT_MS = 3000
const MAX_LOG = 20

export type Runtime = {
  refresh: (io: Io) => Promise<Snapshot>
  publish: (io: Io, snap: Snapshot) => Promise<void>
  record: (io: Io, entry: Entry) => Promise<void>
  start: (io: Io, isInteractive: boolean) => Promise<void>
  stopPolling: () => void
  setEnabled: (io: Io, enabled: boolean) => Promise<void>
  resetSession: (io: Io) => Promise<void>
  refreshQuietly: (io: Io) => void
  setFault: (reason: string | null) => void
  takeFaultNotice: () => boolean
  backgroundStarted: (at: number) => void
}

export const createRuntime = (config: Config): Runtime => {
  const memo = newMemo()
  let timer: { cancel: () => void } | null = null
  let isReading = false
  let fault: string | null = null
  let isFaultShown = false

  const publish = (io: Io, snap: Snapshot) => publishSnapshot(io, config, memo, snap)

  const record = async (io: Io, entry: Entry) => {
    await io.state.log.set(list => [...list, entry].slice(-MAX_LOG))
  }

  const readParents = async (io: Io): Promise<Map<number, number> | null> => {
    try {
      const r = await io.process.run(PS_ARGV, { timeoutMs: PS_TIMEOUT_MS })
      return r.exitCode === 0 ? parseParents(r.stdout) : null
    } catch {
      return null
    }
  }

  // The file every session shares is the history: add this reading when the newest is old enough, then read it all.
  const trackHistory = async (io: Io, snap: Snapshot) => {
    try {
      const samples = await readSamples(io, config.lockPath, snap.at)
      const newest = samples[samples.length - 1]?.at ?? 0
      if (snap.at - newest >= MIN_GAP_MS) {
        const sample = sampleOf(snap, needsTree(snap) ? await readParents(io) : null)
        if (sample !== null && (await appendSample(io, config.lockPath, sample))) samples.push(sample)
      }
      await io.state.history.set(() => samples)
    } catch {
      return
    }
  }

  const refresh = async (io: Io): Promise<Snapshot> => {
    const now = await io.clock.now()
    if (fault !== null) fault = await ensureLock(io, config.lockPath)
    const raw = await takeSnapshot(io, config.lockPath, now)
    const snap: Snapshot = fault === null ? raw : { ...raw, lock: { kind: 'unavailable', reason: fault } }
    await trackHistory(io, snap)
    await publish(io, snap)
    return snap
  }

  const refreshQuietly = (io: Io) => {
    if (isReading) return
    isReading = true
    refresh(io)
      .catch(() => undefined)
      .finally(() => {
        isReading = false
      })
  }

  const startPolling = (io: Io) => {
    timer?.cancel()
    timer = io.clock.every(POLL_MS, () => refreshQuietly(io))
    refreshQuietly(io)
  }

  const stopPolling = () => {
    timer?.cancel()
    timer = null
  }

  const start = async (io: Io, isInteractive: boolean) => {
    const enabled = (await io.store.get('enabled')) !== false
    await io.state.enabled.set(() => enabled)
    if (!enabled) return
    fault = await ensureLock(io, config.lockPath)
    if (isInteractive) startPolling(io)
  }

  const setEnabled = async (io: Io, enabled: boolean) => {
    await io.store.set('enabled', enabled)
    await io.state.enabled.set(() => enabled)
    if (enabled) {
      fault = await ensureLock(io, config.lockPath)
      startPolling(io)
      return
    }
    stopPolling()
    await io.state.waiting.set(() => null)
    memo.lastStatus = undefined
    io.ui.status(undefined)
  }

  const resetSession = async (io: Io) => {
    await io.state.log.set(() => [])
    await io.state.waiting.set(() => null)
  }

  return {
    refresh,
    publish,
    record,
    start,
    stopPolling,
    setEnabled,
    resetSession,
    refreshQuietly,
    setFault: reason => {
      fault = reason
    },
    takeFaultNotice: () => {
      const first = !isFaultShown
      isFaultShown = true
      return first
    },
    backgroundStarted: at => {
      memo.backgroundSince = at
    },
  }
}
