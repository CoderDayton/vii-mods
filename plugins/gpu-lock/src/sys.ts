import type { LockState, Reading, Snapshot } from '../types'
import { clean } from './format'
import { SMI_APPS, SMI_GPUS, parseApps, parseGpus } from './gpu'
import { ensureArgv, ensureReason, lockState, ownerPathOf, parseHolder, probeArgv } from './lock'

export type Sys = {
  process: {
    run: (
      argv: readonly string[],
      init?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  fs: {
    read: (path: string) => Promise<string>
    exists: (path: string) => Promise<boolean>
  }
}

const TIMEOUT_MS = 5000

export const ensureLock = async (sys: Sys, lockPath: string): Promise<string | null> => {
  try {
    const r = await sys.process.run(ensureArgv(lockPath), { timeoutMs: TIMEOUT_MS })
    return ensureReason(r.exitCode)
  } catch {
    return 'the shell could not run'
  }
}

const pidAlive = async (sys: Sys, pid: number): Promise<boolean> => {
  try {
    if (!(await sys.fs.exists('/proc/self'))) return true
    return await sys.fs.exists(`/proc/${pid}`)
  } catch {
    return true
  }
}

export const readLock = async (sys: Sys, lockPath: string): Promise<LockState> => {
  let code: number
  try {
    code = (await sys.process.run(probeArgv(lockPath), { timeoutMs: TIMEOUT_MS })).exitCode
  } catch {
    return { kind: 'unavailable', reason: 'the lock probe could not run' }
  }
  if (code !== 0) return lockState(code, null, true)
  let text: string | null = null
  try {
    text = await sys.fs.read(ownerPathOf(lockPath))
  } catch {
    text = null
  }
  const holder = text === null ? null : parseHolder(text)
  const alive = holder === null ? true : await pidAlive(sys, holder.pid)
  return lockState(0, text, alive)
}

const query = async (sys: Sys, argv: readonly string[]): Promise<{ exitCode: number; text: string } | null> => {
  try {
    const r = await sys.process.run(argv, { timeoutMs: TIMEOUT_MS })
    return { exitCode: r.exitCode, text: r.stdout !== '' ? r.stdout : r.stderr }
  } catch {
    return null
  }
}

export const readGpu = async (sys: Sys): Promise<Reading> => {
  const [gpuAnswer, appsAnswer] = await Promise.all([query(sys, SMI_GPUS), query(sys, SMI_APPS)])
  if (gpuAnswer === null) return { kind: 'none' }
  if (gpuAnswer.exitCode !== 0) {
    const first = gpuAnswer.text.split('\n').find(l => l.trim() !== '') ?? `nvidia-smi exited ${gpuAnswer.exitCode}`
    return { kind: 'error', message: clean(first, 120) }
  }
  const gpus = parseGpus(gpuAnswer.text)
  if (gpus.length === 0) return { kind: 'none' }
  const apps = appsAnswer !== null && appsAnswer.exitCode === 0 ? parseApps(appsAnswer.text) : []
  return { kind: 'ok', gpus, apps }
}

export const takeSnapshot = async (sys: Sys, lockPath: string, now: number): Promise<Snapshot> => {
  const [lock, gpu] = await Promise.all([readLock(sys, lockPath), readGpu(sys)])
  return { at: now, lock, gpu }
}
