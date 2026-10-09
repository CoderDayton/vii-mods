import { parsePeers, SCAN_ARGV } from './peers'
import type { Peer } from './peers'
import { briefing, DROP, taskMessage } from './roles'
import type { Role } from './roles'
import { bossLabel, hireKey, noticeOf } from './team'
import type { Hire, Note, Task } from '../types'
import { lineOf, replyOf } from './transcript'
import type { Text } from './transcript'

// What the pane and the boss's fleet tools do. Both go through here, so a tool and the pane act alike.

export type { Hire, Note }

export type Result = { ok: boolean; text: string }

export type Box<T> = { get: () => Promise<T>; set: (fn: (v: T) => T) => Promise<void> }

export type Io = {
  run: (argv: string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  // Null when the message was delivered, otherwise why not.
  send: (id: string, text: string) => Promise<string | null>
  now: () => Promise<number>
  selfId: () => Promise<string>
  // The time of the session's first reply at or after `since`, or null while it has not replied.
  reply: (peer: Peer, since: number) => Promise<number | null>
  // Every text the session wrote at or after `since`, in order.
  texts: (peer: Peer, since: number) => Promise<Text[]>
  // Drops the transcript cursor kept for one `since`, or every one for the session when `since` is not given.
  forget: (dir: string, id: string, since?: number) => void
  // Queues a prompt for the boss session, which runs it as a turn once the session is idle.
  prompt: (text: string) => Promise<void>
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

const NOTES_KEPT = 6

// A member is dropped after this many scans in a row without its registry line. One missing scan can be a
// registry file caught mid-write.
const MISSES_BEFORE_DROP = 3

// A six-character id for a task, which the employee's reply echoes.
const newTaskId = (): string => Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')

const without = (roster: Record<string, Hire>, id: string): Record<string, Hire> =>
  Object.fromEntries(Object.entries(roster).filter(([key]) => key !== id))

const withTask = (roster: Record<string, Hire>, id: string, task: Task): Record<string, Hire> => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: { ...hire, task } }
}

const markTask = (roster: Record<string, Hire>, id: string, patch: Partial<Task>): Record<string, Hire> => {
  const hire = roster[id]
  return hire?.task === undefined ? roster : { ...roster, [id]: { ...hire, task: { ...hire.task, ...patch } } }
}

const markReady = (roster: Record<string, Hire>, id: string, at: number): Record<string, Hire> => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: { ...hire, readyAt: at } }
}

// Drops each member that has been missing from `alive` for MISSES_BEFORE_DROP scans in a row. A scan that finds the
// member resets its count.
const dropMissing = async (io: Io, misses: Map<string, number>, alive: Set<string>): Promise<void> => {
  for (const [id, hire] of Object.entries(await io.state.roster.get())) {
    if (alive.has(id)) {
      misses.delete(id)
      continue
    }
    const count = (misses.get(id) ?? 0) + 1
    if (count < MISSES_BEFORE_DROP) {
      misses.set(id, count)
      continue
    }
    misses.delete(id)
    await io.store.delete(hireKey(id))
    io.forget(hire.dir, id)
    await io.state.roster.set(roster => without(roster, id))
  }
}

// Reads what the employee wrote since the task was sent. The newest done or blocked echo decides the status, so a
// blocked reply that a later done reply follows is read as done. Otherwise the newest line is kept with its time.
const readTask = async (io: Io, peer: Peer, id: string, task: Task): Promise<void> => {
  const texts = await io.texts(peer, task.sentAt)
  const finish = new RegExp(`\\b(done|blocked)\\s+${task.id}\\b`, 'i')
  const echo = [...texts].reverse().find(t => finish.test(t.text))
  const newest = texts[texts.length - 1]
  if (echo !== undefined) {
    const blocked = new RegExp(`\\bblocked\\s+${task.id}\\b`, 'i').test(echo.text)
    const status = blocked ? 'blocked' : 'done'
    const blocker = blocked ? lineOf(echo.text) : undefined
    const last = replyOf(echo.text, finish)
    // Written only on a change, so a task that stays blocked costs no roster write on each sweep.
    if (status !== task.status || blocker !== task.blocker || last !== task.last) {
      await io.state.roster.set(roster => markTask(roster, id, { status, blocker, last }))
    }
    // The cursor is kept while the task is blocked: a later "done" reply is read from it.
    if (status === 'done') io.forget(peer.dir, peer.id, task.sentAt)
  } else if (task.status === 'sent' && newest !== undefined && (replyOf(newest.text) !== task.last || newest.at !== task.lastAt)) {
    await io.state.roster.set(roster => markTask(roster, id, { last: replyOf(newest.text), lastAt: newest.at }))
  }
}

export const createFleet = (io: Io) => {
  const note = async (ok: boolean, text: string): Promise<Result> => {
    const at = await io.now()
    await io.state.notes.set(notes => [...notes, { ok, text, at }].slice(-NOTES_KEPT))
    return { ok, text }
  }

  // Scans in a row without a member's registry line, by member id. Reset by any scan that finds the member.
  const misses = new Map<string, number>()

  // A scan that fails keeps the team and the list as they were; only a scan that ran can say who is gone.
  const sweep = async (): Promise<Peer[]> => {
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
    await dropMissing(io, misses, new Set(peers.map(p => p.id)))
    for (const [id, hire] of Object.entries(await io.state.roster.get())) {
      const peer = peers.find(p => p.id === id)
      if (hire.readyAt !== undefined || peer === undefined) continue
      const at = await io.reply(peer, hire.briefedAt)
      if (at !== null) {
        await io.state.roster.set(roster => markReady(roster, id, at))
        io.forget(peer.dir, peer.id, hire.briefedAt)
      }
    }
    const now = await io.now()
    for (const [id, hire] of Object.entries(await io.state.roster.get())) {
      const peer = peers.find(p => p.id === id)
      const task = hire.task
      if (task === undefined) continue
      if (task.status !== 'done' && peer !== undefined) await readTask(io, peer, id, task)
      const current = (await io.state.roster.get())[id]?.task
      const notice = current === undefined ? null : noticeOf(hire.name, current, now)
      if (notice !== null && current?.announced !== notice.key) {
        // Marked only once the boss has the notice. A failure is noted in the pane and the next refresh sends it again.
        try {
          await io.prompt(notice.text)
        } catch (error) {
          await note(false, `could not tell the boss about ${hire.name}: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        await io.state.roster.set(roster => markTask(roster, id, { announced: notice.key }))
      }
    }
    return peers
  }

  // Callers that arrive while a sweep runs share its result, so two sweeps never announce the same notice.
  let running: Promise<Peer[]> | undefined
  const refresh = (): Promise<Peer[]> => {
    running ??= sweep().finally(() => {
      running = undefined
    })
    return running
  }

  const task = async (peer: Peer, text: string): Promise<Result> => {
    if (text.trim() === '') return { ok: false, text: 'type the task first' }
    const id = newTaskId()
    const why = await io.send(peer.id, taskMessage(await io.state.boss.get(), id, text.trim()))
    if (why !== null) return note(false, `could not reach ${peer.name}: ${why}`)
    const sentAt = await io.now()
    await io.state.roster.set(roster => withTask(roster, peer.id, { id, sentAt, status: 'sent' }))
    return note(true, `sent ${peer.name} a task`)
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
    misses.delete(peer.id)
    io.forget(peer.dir, peer.id)
    if (why !== null) return note(false, `dropped ${peer.name} from the team, but could not tell it: ${why}`)
    return note(true, `dropped ${peer.name} from the team`)
  }

  return { refresh, task, brief, drop, note }
}

export type Fleet = ReturnType<typeof createFleet>
