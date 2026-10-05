import type { Entry, Snapshot } from '../types'
import type { Io } from './io'
import type { Config } from './options'
import { newMemo, publishSnapshot } from './publish'
import { ensureLock, takeSnapshot } from './sys'

const POLL_MS = 3000
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

  const refresh = async (io: Io): Promise<Snapshot> => {
    const now = await io.clock.now()
    if (fault !== null) fault = await ensureLock(io, config.lockPath)
    const raw = await takeSnapshot(io, config.lockPath, now)
    const snap: Snapshot = fault === null ? raw : { ...raw, lock: { kind: 'unavailable', reason: fault } }
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
