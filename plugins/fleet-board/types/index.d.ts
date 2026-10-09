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
export type Hire = { name: string; dir: string; role: RoleId; briefedAt: number; readyAt?: number }

// The boss an employee was briefed by, kept under the employee's session id.
export type Employment = { bossId: string; bossName: string; role: RoleId }

export type Note = { ok: boolean; text: string; at: number }

// What the pane is showing and what the person has typed in it.
export type Form = {
  view: 'board' | 'new'
  selected: string | null
  role: RoleId
  dir: string
  msg: string
  task: string
  confirmDisband: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'fleet-board': {
      peers: Peer[]
      roster: Record<string, Hire>
      notes: Note[]
      boss: string
      form: Form
      busy: string
      folders: string[]
    }
  }
}
