import type { Entry, Snapshot, Waiting } from '../types'

export type Cell<T> = {
  get: () => Promise<T>
  set: (fn: (value: T) => T) => Promise<void>
}

export type Io = {
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
  clock: {
    now: () => Promise<number>
    every: (ms: number, fn: () => void) => { cancel: () => void }
  }
  session: {
    id: () => Promise<string>
    cwd: () => Promise<string>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
  ui: {
    toast: (text: string) => void
    status: (text: string | undefined) => void
  }
  state: {
    snapshot: Cell<Snapshot | null>
    log: Cell<Entry[]>
    waiting: Cell<Waiting | null>
    enabled: Cell<boolean>
  }
}
