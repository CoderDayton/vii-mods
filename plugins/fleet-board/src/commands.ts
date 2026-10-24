export type Cmd = { kind: 'pane' } | { kind: 'close' } | { kind: 'init' } | { kind: 'bad'; text: string }

// The pane only shows the team. The team is changed and read with the fleet tools the boss calls.
export const USAGE =
  'usage: /fleet opens the fleet pane, /fleet close closes it, /fleet init asks you whom to hire and in which role. The team is changed with fleet_hire, fleet_task, fleet_cancel and fleet_drop, and read with fleet_status.'

export const parseCommand = (args: string): Cmd => {
  const word = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  switch (word) {
    case '':
    case 'open':
      return { kind: 'pane' }
    case 'close':
      return { kind: 'close' }
    case 'init':
      return { kind: 'init' }
    default:
      return { kind: 'bad', text: USAGE }
  }
}
