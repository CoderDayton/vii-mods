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

// A session the pane has briefed.
export type Hire = { role: RoleId; briefedAt: number }

export type Note = { ok: boolean; text: string; at: number }

// What the pane is showing and what the person has typed in it.
export type Form = {
  view: 'board' | 'new'
  selected: string | null
  role: RoleId
  dir: string
  msg: string
  task: string
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
