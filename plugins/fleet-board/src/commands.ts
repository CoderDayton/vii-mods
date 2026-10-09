import type { Fleet, Hire, Result } from './fleet'
import { resolvePeer } from './peers'
import type { Peer } from './peers'
import { roleOf, ROLES } from './roles'
import { headline, rowsOf } from './view'

export type Cmd =
  | { kind: 'pane' }
  | { kind: 'close' }
  | { kind: 'list' }
  | { kind: 'ping'; who: string }
  | { kind: 'pingTeam' }
  | { kind: 'stop'; who: string }
  | { kind: 'drop'; who: string }
  | { kind: 'brief'; who: string; role: string }
  | { kind: 'task'; who: string; text: string }
  | { kind: 'disband' }
  | { kind: 'new'; dir: string; role: string | undefined; task: string }
  | { kind: 'bad'; text: string }

const ROLE_IDS = ROLES.map(r => r.id).join(', ').replace(/, ([^,]*)$/, ' or $1')

export const USAGE = [
  '/fleet                                  open the pane',
  '/fleet list                             list the other sessions',
  '/fleet ping <session|team>              ask for a one-line status',
  `/fleet brief <session> <role>           add it to the team (${ROLE_IDS})`,
  '/fleet task <session> <text>            hand it a task',
  '/fleet stop <session>                   tell it to stop its run',
  '/fleet drop <session>                   take it off the team',
  `/fleet new <folder> [role] [task]        open a new session and brief it`,
  '/fleet disband                          tell the team it is disbanded',
  '/fleet close                            close the pane',
  'A session is its number, its name, its folder name or the start of its name.',
].join('\n')

const bad = (text: string): Cmd => ({ kind: 'bad', text })

export const parseCommand = (args: string): Cmd => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [word = '', first, second] = words
  const rest = (from: number) => words.slice(from).join(' ')
  switch (word.toLowerCase()) {
    case '':
    case 'open':
      return { kind: 'pane' }
    case 'close':
      return { kind: 'close' }
    case 'list':
    case 'status':
      return { kind: 'list' }
    case 'disband':
      return { kind: 'disband' }
    case 'ping':
      if (first === undefined) return bad('usage: /fleet ping <session|team>')
      return first.toLowerCase() === 'team' ? { kind: 'pingTeam' } : { kind: 'ping', who: first }
    case 'stop':
      return first === undefined ? bad('usage: /fleet stop <session>') : { kind: 'stop', who: first }
    case 'drop':
      return first === undefined ? bad('usage: /fleet drop <session>') : { kind: 'drop', who: first }
    case 'task':
      return first === undefined || rest(2) === '' ? bad('usage: /fleet task <session> <text>') : { kind: 'task', who: first, text: rest(2) }
    case 'brief':
      if (first === undefined || second === undefined) return bad(`usage: /fleet brief <session> <${ROLES.map(r => r.id).join('|')}>`)
      return roleOf(second) === undefined ? bad(`unknown role "${second}"; use ${ROLE_IDS}`) : { kind: 'brief', who: first, role: second }
    case 'new': {
      if (first === undefined) return bad('usage: /fleet new <folder> [role] [task]')
      const hasRole = second !== undefined && roleOf(second) !== undefined
      return { kind: 'new', dir: first, role: hasRole ? second : undefined, task: rest(hasRole ? 3 : 2) }
    }
    default:
      return bad(`unknown command "${word}"\n${USAGE}`)
  }
}

export type CommandContext = { roster: Readonly<Record<string, Hire>>; now: number; quietMs: number }

export type CommandOut = { text: string; action?: 'pane' | 'close' }

const pad = (cells: string[], widths: number[]): string => cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i] ?? 0) : c)).join('  ')

const listText = (peers: readonly Peer[], ctx: CommandContext): string => {
  const rows = rowsOf(peers, ctx.roster, ctx.now, ctx.quietMs)
  const cells = rows.map(r => [String(r.n), r.name, r.folder, r.state === 'unknown' ? '?' : r.state, r.isQuiet ? `${r.age} !` : r.age, r.role])
  const widths = [0, 1, 2, 3, 4].map(i => Math.max(...cells.map(c => (c[i] ?? '').length)))
  return [`fleet: ${headline(rows)}`, ...cells.map(c => pad(c, widths))].join('\n')
}

export const runCommand = async (cmd: Cmd, fleet: Fleet, ctx: CommandContext): Promise<CommandOut> => {
  const out = (r: Result): CommandOut => ({ text: r.text })
  const target = async (who: string): Promise<{ peer: Peer } | { error: string }> => resolvePeer(await fleet.refresh(), who)
  switch (cmd.kind) {
    case 'pane':
    case 'close':
      return { text: '', action: cmd.kind }
    case 'bad':
      return { text: cmd.text }
    case 'list': {
      const peers = await fleet.refresh()
      return { text: peers.length === 0 ? 'fleet: no other Claude session is running' : listText(peers, ctx) }
    }
    case 'pingTeam':
      await fleet.refresh()
      return out(await fleet.pingTeam())
    case 'disband':
      await fleet.refresh()
      return out(await fleet.disband())
    case 'new':
      return out(await fleet.open({ dir: cmd.dir, role: (cmd.role !== undefined ? roleOf(cmd.role) : undefined) ?? ROLES[0]!, task: cmd.task }))
    default: {
      const found = await target(cmd.who)
      if ('error' in found) return { text: found.error }
      if (cmd.kind === 'ping') return out(await fleet.ping(found.peer))
      if (cmd.kind === 'stop') return out(await fleet.stop(found.peer))
      if (cmd.kind === 'drop') return out(await fleet.drop(found.peer))
      if (cmd.kind === 'task') return out(await fleet.task(found.peer, cmd.text))
      return out(await fleet.brief(found.peer, roleOf(cmd.role) ?? ROLES[0]!))
    }
  }
}
