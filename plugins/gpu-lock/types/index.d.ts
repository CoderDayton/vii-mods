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
  uuid?: string
}

export type App = { pid: number; name: string; usedMiB: number; gpu?: string }

export type Reading =
  | { kind: 'ok'; gpus: Gpu[]; apps: App[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

export type LockState =
  | { kind: 'free' }
  | { kind: 'held'; holder: Holder | null }
  | { kind: 'shared'; holders: Holder[] }
  | { kind: 'unavailable'; reason: string }

export type Snapshot = { at: number; lock: LockState; gpu: Reading; waiters: Holder[] }

export type Entry = {
  at: number
  kind: 'ran' | 'failed' | 'refused'
  cmd: string
  ms: number | null
  note: string
}

export type Waiting = { cmd: string; since: number }

// One reading of every card. A card's `jobs` maps a holder's pid to the MiB its processes use there.
export type CardSample = { usedMiB: number; totalMiB: number; jobs: Record<string, number> }
export type Sample = {
  at: number
  gpus: CardSample[]
  jobs: Record<string, { session: string; cmd: string }>
}

declare module 'claude-code' {
  interface PluginState {
    'gpu-lock': {
      snapshot: Snapshot | null
      log: Entry[]
      waiting: Waiting | null
      history: Sample[]
      enabled: boolean
    }
  }
}
