export type PeerState = 'working' | 'idle' | 'unknown'

// Another running Claude session, as its registry record says.
export type Peer = {
  id: string
  pid: number
  name: string
  dir: string
  state: PeerState
  startedAt: number
  updatedAt: number
}

export type RoleId = 'specialist' | 'local' | 'research'

// A session the boss has briefed onto its team. `readyAt` is the time of its first reply after the briefing,
// read from its transcript; absent while it has not replied.
// The status of a task the boss sent. `blocked` is set when the reply says "blocked <id>".
export type TaskStatus = 'sent' | 'done' | 'blocked' | 'cancelled'

export type Brief = { text: string; scope?: string; done?: string }

// The last task sent to a member. `id` is the id the employee echoes in its reply, and `sentAt` is when it was sent.
// `blocker` is the line of the reply that said it is blocked. `last` is the newest line the employee wrote after the
// task was sent, kept while the task is still sent.
// `lastAt` is when that newest line was written. `announced` is the key of the last message sent to the boss about the task.
export type Task = {
  id: string
  sentAt: number
  status: TaskStatus
  text?: string
  scope?: string
  done?: string
  blocker?: string
  last?: string
  lastAt?: number
  endedAt?: number
  announced?: string
}

export type QueuedTask = Brief & { id: string; after?: string; queuedAt: number; stuck?: string }

export type Hire = {
  name: string
  dir: string
  role: RoleId
  briefedAt: number
  readyAt?: number
  task?: Task
  queue?: QueuedTask[]
  history?: Task[]
}

// The boss an employee was briefed by, kept under the employee's session id.
export type Employment = { bossId: string; bossName: string; role: RoleId }

export type Note = { ok: boolean; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'fleet-board': {
      peers: Peer[]
      roster: Record<string, Hire>
      notes: Note[]
      boss: string
      selected: string
    }
  }
}
