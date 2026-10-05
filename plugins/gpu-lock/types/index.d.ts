export type Holder = {
  session: string
  agent: string | null
  cmd: string
  cwd: string
  why: string
  pid: number
  since: number
  needMiB: number | null
}

export type Gpu = {
  index: number
  name: string
  usedMiB: number
  totalMiB: number
  util: number | null
  tempC: number | null
}

export type App = { pid: number; name: string; usedMiB: number }

export type Reading =
  | { kind: 'ok'; gpus: Gpu[]; apps: App[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

export type LockState =
  | { kind: 'free' }
  | { kind: 'held'; holder: Holder | null }
  | { kind: 'unavailable'; reason: string }

export type Snapshot = { at: number; lock: LockState; gpu: Reading }

export type Entry = {
  at: number
  kind: 'ran' | 'failed' | 'refused'
  cmd: string
  ms: number | null
  note: string
}

export type Waiting = { cmd: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    'gpu-lock': {
      snapshot: Snapshot | null
      log: Entry[]
      waiting: Waiting | null
      enabled: boolean
    }
  }
}
