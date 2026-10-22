import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CaptionUnavailableError } from './errors'
import { isReady, startServer } from './server'

export const KEEP_MS = 60_000

const POLL_MS = 250
const START_MS = 130_000
const STOP_MS = 5000
const PROBES = 3
const PROBE_GAP_MS = 300
const SCRIPT = join(import.meta.dir, '../../../bin/lookback.ts')

export type Lease = { baseURL: string; touch(): boolean }
export type KeeperOptions = { command: string; statePath: string; idleMs: number }

type State = { keeper: number; server: number; baseURL: string; command: string } | { error: string; command: string }

const readState = (path: string): State | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as State
  } catch {
    return null
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const healthOf = (baseURL: string): string => `${baseURL.replace(/\/v1$/, '')}/health`

const touchFile = (path: string): boolean => {
  try {
    const now = new Date()
    utimesSync(path, now, now)
    return true
  } catch {
    return false
  }
}

const answers = async (baseURL: string): Promise<boolean> => {
  for (let i = 0; i < PROBES; i++) {
    if (await isReady(healthOf(baseURL))) return true
    await Bun.sleep(PROBE_GAP_MS)
  }
  return false
}

const stopKeeper = async (pid: number): Promise<void> => {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  for (const end = Date.now() + STOP_MS; Date.now() < end && alive(pid); await Bun.sleep(50));
  if (alive(pid)) process.kill(pid, 'SIGKILL')
}

const running = async (statePath: string, command: string): Promise<string | null> => {
  const state = readState(statePath)
  if (state === null || !('keeper' in state) || !alive(state.keeper)) return null
  if (state.command !== command) {
    await stopKeeper(state.keeper)
    return null
  }
  return (await answers(state.baseURL)) ? state.baseURL : null
}

const holderOf = (path: string): number => {
  try {
    return Number(readFileSync(path, 'utf8'))
  } catch {
    return 0
  }
}

const withLock = async <T>(path: string, work: () => Promise<T>): Promise<T> => {
  mkdirSync(dirname(path), { recursive: true })
  for (const end = Date.now() + 2 * START_MS; ; ) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const holder = holderOf(path)
      if (holder !== 0 && !alive(holder) && holderOf(path) === holder) rmSync(path, { force: true })
      if (Date.now() >= end) throw new CaptionUnavailableError('another run held the caption server start for too long')
      await Bun.sleep(50)
    }
  }
  try {
    return await work()
  } finally {
    rmSync(path, { force: true })
  }
}

export const leaseServer = (options: KeeperOptions): Promise<Lease> => withLock(`${options.statePath}.lock`, () => lease(options))

const lease = async ({ command, statePath, idleMs }: KeeperOptions): Promise<Lease> => {
  const touch = (): boolean => touchFile(statePath)
  const reused = await running(statePath, command)
  if (reused !== null && touch()) return { baseURL: reused, touch }
  mkdirSync(dirname(statePath), { recursive: true })
  rmSync(statePath, { force: true })
  const child = Bun.spawn([process.execPath, SCRIPT, 'keeper', '--state', statePath, '--idle', String(idleMs), '--command', command], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
  })
  child.unref()
  for (const end = Date.now() + START_MS; Date.now() < end; await Bun.sleep(100)) {
    const state = readState(statePath)
    if (state !== null && 'error' in state) throw new CaptionUnavailableError(state.error)
    if (state !== null && (await isReady(healthOf(state.baseURL)))) {
      touch()
      return { baseURL: state.baseURL, touch }
    }
    if (child.exitCode !== null) throw new CaptionUnavailableError(`the caption server keeper exited with code ${child.exitCode} before it was ready`)
  }
  child.kill('SIGKILL')
  throw new CaptionUnavailableError(`the caption server was not ready after ${Math.round(START_MS / 1000)} s`)
}

export const runKeeper = async ({ command, statePath, idleMs }: KeeperOptions): Promise<void> => {
  const publish = (state: State): void => {
    const next = `${statePath}.${process.pid}`
    writeFileSync(next, JSON.stringify(state))
    renameSync(next, statePath)
  }
  let server
  try {
    server = await startServer(command)
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : String(error), command })
    return
  }
  const mine = (): boolean => {
    const state = readState(statePath)
    return state !== null && 'keeper' in state && state.keeper === process.pid
  }
  const release = (): void => {
    if (mine()) rmSync(statePath, { force: true })
  }
  process.once('exit', release)
  publish({ keeper: process.pid, server: server.pid, baseURL: server.baseURL, command })
  const idle = (): boolean => {
    const closing = `${statePath}.closing`
    try {
      if (Date.now() - statSync(statePath).mtimeMs <= idleMs) return false
      renameSync(statePath, closing)
      if (Date.now() - statSync(closing).mtimeMs <= idleMs) {
        renameSync(closing, statePath)
        return false
      }
      rmSync(closing, { force: true })
      return true
    } catch {
      return true
    }
  }
  for (;;) {
    await Bun.sleep(POLL_MS)
    if (!mine() || !alive(server.pid) || idle()) break
  }
  release()
  await server.stop()
}
