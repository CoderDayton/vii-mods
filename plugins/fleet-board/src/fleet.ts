import { describeLauncher, launchArgv, parseProbe, pickLauncher, PROBE_ARGV, splitArgs } from './launch'
import type { LauncherOption } from './launch'
import { baseName, parsePeers, SCAN_ARGV } from './peers'
import type { Peer } from './peers'
import { briefing, DISBAND, DROP, PING, STOP, taskMessage } from './roles'
import type { Role } from './roles'
import { bossLabel, hireKey } from './team'
import type { Hire, Note } from '../types'

// What the pane and the /fleet command do. Both go through here, so a button and a typed command act alike.

export type { Hire, Note }

export type Result = { ok: boolean; text: string }

export type Config = { launcher: LauncherOption; claudeArgs: string; quietMs: number; waitMs: number }

export type Box<T> = { get: () => Promise<T>; set: (fn: (v: T) => T) => Promise<void> }

export type Io = {
  run: (argv: string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  // Null when the message was delivered, otherwise why not.
  send: (id: string, text: string) => Promise<string | null>
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  exists: (path: string) => Promise<boolean>
  selfId: () => Promise<string>
  // The time of the session's first reply at or after `since`, or null while it has not replied.
  reply: (peer: Peer, since: number) => Promise<number | null>
  store: {
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  state: {
    peers: Box<Peer[]>
    roster: Box<Record<string, Hire>>
    notes: Box<Note[]>
    boss: Box<string>
  }
}

export type OpenRequest = { dir: string; role: Role; task: string }

const NOTES_KEPT = 6
const POLL_MS = 1000

const trimSlash = (dir: string): string => (dir.length > 1 ? dir.replace(/\/+$/, '') : dir)

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)

const without = (roster: Record<string, Hire>, id: string): Record<string, Hire> =>
  Object.fromEntries(Object.entries(roster).filter(([key]) => key !== id))

const markReady = (roster: Record<string, Hire>, id: string, at: number): Record<string, Hire> => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: { ...hire, readyAt: at } }
}

export const createFleet = (io: Io, config: Config) => {
  const note = async (ok: boolean, text: string): Promise<Result> => {
    const at = await io.now()
    await io.state.notes.set(notes => [...notes, { ok, text, at }].slice(-NOTES_KEPT))
    return { ok, text }
  }

  // A scan that fails keeps the team and the list as they were; only a scan that ran can say who is gone.
  const refresh = async (): Promise<Peer[]> => {
    const self = await io.selfId()
    const scan = await io.run(SCAN_ARGV)
    if (scan.exitCode !== 0) return io.state.peers.get()
    const scanned = parsePeers(scan.stdout)
    const mine = scanned.find(p => p.id === self)
    if (mine !== undefined) await io.state.boss.set(() => mine.name)
    const peers = scanned
      .filter(p => p.id !== self)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    await io.state.peers.set(() => peers)
    const alive = new Set(peers.map(p => p.id))
    for (const id of Object.keys(await io.state.roster.get())) {
      if (!alive.has(id)) await io.store.delete(hireKey(id))
    }
    await io.state.roster.set(roster => Object.fromEntries(Object.entries(roster).filter(([id]) => alive.has(id))))
    for (const [id, hire] of Object.entries(await io.state.roster.get())) {
      const peer = peers.find(p => p.id === id)
      if (hire.readyAt !== undefined || peer === undefined) continue
      const at = await io.reply(peer, hire.briefedAt)
      if (at !== null) await io.state.roster.set(roster => markReady(roster, id, at))
    }
    return peers
  }

  const tell = async (peer: Peer, text: string, done: string): Promise<Result> => {
    const why = await io.send(peer.id, text)
    return why === null ? note(true, done) : note(false, `could not reach ${peer.name}: ${why}`)
  }

  const ping = (peer: Peer) => tell(peer, PING, `asked ${peer.name} for status`)

  const stop = (peer: Peer) => tell(peer, STOP, `told ${peer.name} to stop its run`)

  const task = async (peer: Peer, text: string): Promise<Result> => {
    if (text.trim() === '') return { ok: false, text: 'type the task first' }
    return tell(peer, taskMessage(await io.state.boss.get(), text.trim()), `sent ${peer.name} a task`)
  }

  const brief = async (peer: Peer, role: Role): Promise<Result> => {
    const self = await io.selfId()
    const name = await io.state.boss.get()
    const why = await io.send(peer.id, briefing(bossLabel(name, self), role))
    if (why !== null) return note(false, `could not reach ${peer.name}: ${why}`)
    const briefedAt = await io.now()
    await io.state.roster.set(roster => ({ ...roster, [peer.id]: { name: peer.name, dir: peer.dir, role: role.id, briefedAt } }))
    await io.store.set(hireKey(peer.id), { bossId: self, bossName: name, role: role.id })
    return note(true, `briefed ${peer.name} as ${role.label}`)
  }

  // The member is taken off the team even when the message does not arrive: the boss has decided, and the
  // result says whether the member was told.
  const drop = async (peer: Peer): Promise<Result> => {
    if ((await io.state.roster.get())[peer.id] === undefined) return note(false, `${peer.name} is not on the team`)
    const why = await io.send(peer.id, DROP)
    await io.state.roster.set(roster => without(roster, peer.id))
    await io.store.delete(hireKey(peer.id))
    if (why !== null) return note(false, `dropped ${peer.name} from the team, but could not tell it: ${why}`)
    return note(true, `dropped ${peer.name} from the team`)
  }

  const team = async (): Promise<Peer[]> => {
    const roster = await io.state.roster.get()
    return (await io.state.peers.get()).filter(p => roster[p.id] !== undefined)
  }

  const pingTeam = async (): Promise<Result> => {
    const members = await team()
    if (members.length === 0) return note(false, 'nobody is on the team yet; brief a session first')
    const failed: string[] = []
    for (const p of members) if ((await io.send(p.id, PING)) !== null) failed.push(p.name)
    const noun = members.length === 1 ? 'session' : 'sessions'
    return failed.length === 0
      ? note(true, `asked ${members.length} ${noun} for status`)
      : note(false, `asked ${members.length - failed.length} of ${members.length} ${noun}; could not reach ${failed.join(', ')}`)
  }

  // Every member is cleared, reached or not. The result names the ones that were not reached.
  const disband = async (): Promise<Result> => {
    const members = await team()
    if (members.length === 0) return note(false, 'nobody is on the team')
    const failed: string[] = []
    for (const p of members) if ((await io.send(p.id, DISBAND)) !== null) failed.push(p.name)
    for (const id of Object.keys(await io.state.roster.get())) await io.store.delete(hireKey(id))
    await io.state.roster.set(() => ({}))
    return failed.length === 0
      ? note(true, `disbanded the team of ${members.length}`)
      : note(false, `disbanded the team of ${members.length}; could not reach ${failed.join(', ')}`)
  }

  const waitFor = async (known: ReadonlySet<string>, dir: string): Promise<Peer | undefined> => {
    const tries = Math.max(1, Math.ceil(config.waitMs / POLL_MS))
    for (let i = 0; i < tries; i++) {
      await io.sleep(POLL_MS)
      const found = (await refresh()).find(p => !known.has(p.id) && trimSlash(p.dir) === dir)
      if (found !== undefined) return found
    }
    return undefined
  }

  const open = async ({ dir: given, role, task: first }: OpenRequest): Promise<Result> => {
    const dir = trimSlash(given.trim())
    if (!dir.startsWith('/')) return note(false, 'the folder must be an absolute path')
    if (!(await io.exists(dir))) return note(false, `${dir} is not a folder`)
    const probe = parseProbe((await io.run(PROBE_ARGV)).stdout)
    const launcher = pickLauncher(config.launcher, probe)
    if (launcher === null) return note(false, `no terminal window or tmux found to open a session in (launcher: ${config.launcher})`)

    const known = new Set((await refresh()).map(p => p.id))
    const tag = `fleet-${slug(baseName(dir)) || 'session'}-${(await io.now()).toString(36).slice(-4)}`
    const started = await io.run(launchArgv(launcher, dir, splitArgs(config.claudeArgs), tag, probe))
    if (started.exitCode !== 0) {
      const why = started.stderr.split('\n')[0]?.trim() || `exit code ${started.exitCode}`
      return note(false, `could not start ${launcher}: ${why}`)
    }

    const hint = launcher === 'tmux' ? `; see it with: tmux attach -t ${tag}` : ''
    const peer = await waitFor(known, dir)
    if (peer === undefined) {
      return note(false, `started ${launcher} in ${dir}, but the session has not appeared after ${Math.round(config.waitMs / 1000)} s${hint}`)
    }
    const briefed = await brief(peer, role)
    if (!briefed.ok) return note(false, `opened ${peer.name}, but ${briefed.text}`)
    if (first.trim() !== '') {
      const sent = await task(peer, first)
      if (!sent.ok) return note(false, `opened ${peer.name}, but ${sent.text}`)
    }
    return note(true, `opened ${peer.name} in ${describeLauncher(launcher)} as ${role.label}${hint}`)
  }

  return { refresh, ping, stop, task, brief, drop, pingTeam, disband, open, team, note }
}

export type Fleet = ReturnType<typeof createFleet>
