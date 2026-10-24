import { askKey, asksOf, fileKey, keyedOnce, messagesOf, postKey, postsOf, renamedKey, renamesOf, renderTeamFile, teamFile, trimMessages } from './crew'
import type { Store } from './crew'
import { isInside, parsePeers, SCAN_ARGV } from './peers'
import type { Peer } from './peers'
import { holdOf, isDone, markEarlier, markReady, markTask, noticesOf, queuedOf, startTask, takerOf, without, withoutQueued, withQueued } from './queue'
import { briefing, cancelMessage, DROP, roleChange, taskMessage } from './roles'
import type { Role } from './roles'
import { bossLabel, hireKey, REPORT } from './team'
import type { Brief, Hire, Note, PooledTask, RoleId, Task } from '../types'
import { lineOf, replyOf } from './transcript'
import type { Text } from './transcript'

// What the pane and the boss's fleet tools do. Both go through here, so a tool and the pane act alike.

export type { Hire, Note }

export type Result = { ok: boolean; text: string }

type Member = Pick<Peer, 'id' | 'name' | 'dir'>

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
  store: Store
  writeFile: (path: string, text: string) => Promise<void>
  teamDir: string
  state: {
    peers: Box<Peer[]>
    roster: Box<Record<string, Hire>>
    pool: Box<PooledTask[]>
    notes: Box<Note[]>
    boss: Box<string>
  }
}

const NOTES_KEPT = 6

// A member is dropped after this many scans in a row without its registry line. One missing scan can be a
// registry file caught mid-write.
const MISSES_BEFORE_DROP = 3

// A six-character id for a task, which the employee's reply echoes.
export const newTaskId = (): string => Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const addNote = async (io: Io, ok: boolean, text: string): Promise<Result> => {
  const at = await io.now()
  await io.state.notes.set(notes => [...notes, { ok, text, at }].slice(-NOTES_KEPT))
  return { ok, text }
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
    await io.store.delete(postKey(await io.selfId(), id))
    io.forget(hire.dir, id)
    await io.state.roster.set(roster => without(roster, id))
  }
}

const readEarlier = async (io: Io, peer: Peer, id: string, task: Task): Promise<void> => {
  const finish = new RegExp(`\\bdone\\s+${task.id}\\b`, 'i')
  const echo = [...(await io.texts(peer, task.sentAt))].reverse().find(t => finish.test(t.text))
  if (echo === undefined) return
  await io.state.roster.set(roster => markEarlier(roster, id, task.id, { status: 'done', last: replyOf(echo.text, finish), endedAt: echo.at }))
  io.forget(peer.dir, peer.id, task.sentAt)
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
      const endedAt = status === task.status ? task.endedAt : echo.at
      await io.state.roster.set(roster => markTask(roster, id, { status, blocker, last, endedAt }))
    }
    // The cursor is kept while the task is blocked: a later "done" reply is read from it.
    if (status === 'done') io.forget(peer.dir, peer.id, task.sentAt)
  } else if (task.status === 'sent' && newest !== undefined && (replyOf(newest.text) !== task.last || newest.at !== task.lastAt)) {
    await io.state.roster.set(roster => markTask(roster, id, { last: replyOf(newest.text), lastAt: newest.at }))
  }
}

const readTeam = async (io: Io, peers: readonly Peer[]): Promise<void> => {
  for (const [id, hire] of Object.entries(await io.state.roster.get())) {
    const peer = peers.find(p => p.id === id)
    if (peer === undefined) continue
    if (hire.readyAt === undefined) {
      const at = await io.reply(peer, hire.briefedAt)
      if (at !== null) {
        await io.state.roster.set(roster => markReady(roster, id, at))
        io.forget(peer.dir, peer.id, hire.briefedAt)
      }
    }
    const task = hire.task
    if (task !== undefined && (task.status === 'sent' || task.status === 'blocked')) await readTask(io, peer, id, task)
    for (const earlier of hire.history ?? []) if (earlier.status === 'blocked') await readEarlier(io, peer, id, earlier)
  }
}

const importRenames = async (io: Io, misses: Map<string, number>): Promise<void> => {
  const self = await io.selfId()
  for (const { from, to } of await renamesOf(io.store, self)) {
    await io.store.delete(renamedKey(self, from))
    const hire = (await io.state.roster.get())[from]
    if (hire === undefined) continue
    misses.delete(from)
    io.forget(hire.dir, from)
    await io.state.roster.set(roster => {
      const { [from]: moved, ...rest } = roster
      return moved === undefined ? roster : { ...rest, [to]: moved }
    })
    await addNote(io, true, `${hire.name} started a new conversation and stays on the team`)
  }
}

const importAsks = async (io: Io): Promise<string[]> => {
  const self = await io.selfId()
  const told: string[] = []
  const tell = (head: string, text: string): void => void told.push(`${head}: ${lineOf(text)} ${REPORT}`)
  for (const { id, ask } of await asksOf(io.store, self)) {
    await io.store.delete(askKey(self, id))
    if (ask === null) continue
    const queued = queuedOf(id, ask, ask.at)
    const hire = ask.session === undefined ? undefined : (await io.state.roster.get())[ask.session]
    if (ask.session !== undefined && hire !== undefined) {
      await io.state.roster.set(roster => withQueued(roster, ask.session ?? '', queued))
      tell(`${ask.fromName} created task ${id} for ${hire.name}`, ask.text)
    } else if (ask.role !== undefined) {
      const role = ask.role
      await io.state.pool.set(pool => [...pool, { ...queued, role }])
      tell(`${ask.fromName} created task ${id} for the next free ${role} member`, ask.text)
    } else {
      tell(`${ask.fromName} created task ${id} for a session no longer on the team, so it was dropped`, ask.text)
    }
  }
  return told
}

const writeTeam = async (io: Io, last: { text?: string; path?: string; failed?: string }): Promise<void> => {
  const self = await io.selfId()
  const roster = await io.state.roster.get()
  if (Object.keys(roster).length === 0 && last.text === undefined) return
  await trimMessages(io.store, self)
  const messages = (await messagesOf(io.store, self)).map(m => m.message)
  const text = renderTeamFile(self, await io.state.boss.get(), roster, await postsOf(io.store, self), messages)
  const path = teamFile(io.teamDir, self)
  if (text === last.text && path === last.path) return
  try {
    await io.writeFile(path, text)
  } catch (error) {
    if (last.failed !== text) await addNote(io, false, `could not write the team file: ${errorText(error)}`)
    last.failed = text
    return
  }
  if (path !== last.path) await io.store.set(fileKey(self), path)
  last.text = text
  last.path = path
  delete last.failed
}

const announce = async (io: Io, created: readonly string[]): Promise<void> => {
  const pending = noticesOf(await io.state.roster.get(), await io.state.pool.get(), await io.now())
  const said = [...created, ...pending.flatMap(p => (p.text === null ? [] : [p.text]))]
  if (said.length > 0) await io.prompt(said.join('\n\n'))
  for (const text of said) await addNote(io, true, lineOf(text).replace(` ${REPORT}`, ''))
  for (const p of pending) {
    if (p.roster !== undefined) await io.state.roster.set(p.roster)
    if (p.pool !== undefined) await io.state.pool.set(p.pool)
  }
}

type Sent = { sent: string } | { why: string } | null

const sendHead = async (io: Io, id: string): Promise<Sent> => {
  const roster = await io.state.roster.get()
  const hire = roster[id]
  const head = hire?.queue?.[0]
  if (hire === undefined || head === undefined) return null
  if (holdOf(roster, await io.state.peers.get(), id, head) !== null) return null
  const why = await io.send(id, taskMessage(await io.state.boss.get(), head.id, head))
  if (why !== null) {
    await addNote(io, false, `could not reach ${hire.name}: ${why}`)
    return { why }
  }
  const sentAt = await io.now()
  const pool = await io.state.pool.get()
  await io.state.roster.set(r => startTask(r, pool, id, head, sentAt))
  const kept = new Set(((await io.state.roster.get())[id]?.history ?? []).map(t => t.id))
  for (const old of [...(hire.history ?? []), ...(hire.task === undefined ? [] : [hire.task])]) {
    if (old.status === 'blocked' && !kept.has(old.id)) io.forget(hire.dir, id, old.sentAt)
  }
  return { sent: head.id }
}

const handTo = async (io: Io, entry: PooledTask, taker: string): Promise<string | null> => {
  const { role: _role, stuck: _stuck, ...queued } = entry
  await io.state.roster.set(roster => withQueued(roster, taker, queued))
  const out = await sendHead(io, taker)
  if (out !== null && 'sent' in out) {
    await io.state.pool.set(pool => pool.filter(p => p.id !== entry.id))
    return null
  }
  await io.state.roster.set(roster => withoutQueued(roster, taker, entry.id))
  const name = (await io.state.roster.get())[taker]?.name ?? taker
  return out === null ? `${name} could not take it` : `could not reach ${name}: ${out.why}`
}

const handOut = async (io: Io): Promise<Map<string, string>> => {
  const failed = new Map<string, string>()
  for (const entry of await io.state.pool.get()) {
    const skip = new Set<string>()
    while ((await io.state.pool.get()).some(p => p.id === entry.id)) {
      const taker = takerOf(await io.state.roster.get(), await io.state.peers.get(), entry, skip)
      if (taker === null) break
      const why = await handTo(io, entry, taker)
      if (why === null) failed.delete(entry.id)
      else failed.set(entry.id, why)
      skip.add(taker)
    }
  }
  return failed
}

const placed = async (io: Io, id: string): Promise<Result> => {
  const roster = await io.state.roster.get()
  const members = Object.entries(roster)
  const sent = members.find(([, h]) => h.task?.id === id)?.[1]
  if (sent !== undefined) return addNote(io, true, `sent ${sent.name} task ${id}`)
  const pooled = (await io.state.pool.get()).find(p => p.id === id)
  if (pooled !== undefined) {
    const after = pooled.after !== undefined && !isDone(roster, pooled.after) ? `, after task ${pooled.after}` : ''
    return addNote(io, true, `queued task ${id} for the next free ${pooled.role} member${after}`)
  }
  for (const [memberId, hire] of members) {
    const entry = hire.queue?.find(q => q.id === id)
    if (entry === undefined) continue
    const hold = holdOf(roster, await io.state.peers.get(), memberId, entry) ?? 'next in line'
    return addNote(io, true, `queued task ${id} for ${hire.name}, ${hold}`)
  }
  return addNote(io, false, `task ${id} is no longer on the team`)
}

const scan = async (io: Io): Promise<{ peers: Peer[]; outside: Peer[] } | null> => {
  const self = await io.selfId()
  const out = await io.run(SCAN_ARGV)
  if (out.exitCode !== 0) return null
  const scanned = parsePeers(out.stdout)
  const mine = scanned.find(p => p.id === self)
  if (mine !== undefined) await io.state.boss.set(() => mine.name)
  const everyone = scanned.filter(p => p.id !== self).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  // Only the boss's own project: its folder and what is inside it. Team members stay wherever they are, and
  // without an entry for the boss nothing is hidden.
  const root = mine?.dir ?? ''
  const roster = await io.state.roster.get()
  const peers = everyone.filter(p => root === '' || isInside(p.dir, root) || roster[p.id] !== undefined)
  await io.state.peers.set(() => peers)
  return { peers, outside: everyone.filter(p => !peers.includes(p)) }
}

const brief = async (io: Io, peer: Peer, role: Role): Promise<Result> => {
  const self = await io.selfId()
  const name = await io.state.boss.get()
  const why = await io.send(peer.id, briefing(bossLabel(name, self), role))
  if (why !== null) return addNote(io, false, `could not reach ${peer.name}: ${why}`)
  const briefedAt = await io.now()
  await io.state.roster.set(roster => ({ ...roster, [peer.id]: { name: peer.name, dir: peer.dir, role: role.id, briefedAt } }))
  await io.store.set(hireKey(peer.id), { bossId: self, bossName: name, role: role.id })
  return addNote(io, true, `briefed ${peer.name} as ${role.label}`)
}

// The member is taken off the team even when the message does not arrive: the boss has decided, and the
// result says whether the member was told.
const drop = async (io: Io, misses: Map<string, number>, peer: Peer): Promise<Result> => {
  if ((await io.state.roster.get())[peer.id] === undefined) return addNote(io, false, `${peer.name} is not on the team`)
  const why = await io.send(peer.id, DROP)
  await io.state.roster.set(roster => without(roster, peer.id))
  await io.store.delete(hireKey(peer.id))
  await io.store.delete(postKey(await io.selfId(), peer.id))
  misses.delete(peer.id)
  io.forget(peer.dir, peer.id)
  if (why !== null) return addNote(io, false, `dropped ${peer.name} from the team, but could not tell it: ${why}`)
  return addNote(io, true, `dropped ${peer.name} from the team`)
}

const setRole = async (io: Io, peer: Peer, role: Role): Promise<Result> => {
  const hire = (await io.state.roster.get())[peer.id]
  if (hire === undefined) return addNote(io, false, `${peer.name} is not on the team`)
  if (hire.role === role.id) return addNote(io, false, `${peer.name} is already ${role.label}`)
  const why = await io.send(peer.id, roleChange(role))
  await io.state.roster.set(roster => {
    const now = roster[peer.id]
    return now === undefined ? roster : { ...roster, [peer.id]: { ...now, role: role.id } }
  })
  await io.store.set(hireKey(peer.id), { bossId: await io.selfId(), bossName: await io.state.boss.get(), role: role.id })
  if (why !== null) return addNote(io, false, `made ${peer.name} ${role.label}, but could not tell it: ${why}`)
  return addNote(io, true, `made ${peer.name} ${role.label}`)
}

export const createFleet = (io: Io) => {
  const note = (ok: boolean, text: string): Promise<Result> => addNote(io, ok, text)

  // The sessions the last scan found outside the boss's folder. Not listed, but named in the error when one is hired.
  let outside: Peer[] = []

  // Scans in a row without a member's registry line, by member id. Reset by any scan that finds the member.
  const misses = new Map<string, number>()

  const written: { text?: string; failed?: string } = {}

  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work)
    chain = run.catch(() => undefined)
    return run
  }
  const sendNext = (id: string): Promise<Sent> => serial(() => sendHead(io, id))
  const dispatch = (): Promise<void> =>
    serial(async () => {
      for (const id of Object.keys(await io.state.roster.get())) await sendHead(io, id)
      await handOut(io)
    })

  // A scan that fails keeps the team and the list as they were; only a scan that ran can say who is gone.
  const sweep = async (): Promise<Peer[]> => {
    const found = await scan(io)
    if (found === null) return io.state.peers.get()
    const { peers } = found
    outside = found.outside
    const swept: Io = { ...io, store: keyedOnce(io.store) }
    await importRenames(swept, misses)
    await dropMissing(swept, misses, new Set(peers.map(p => p.id)))
    const created = await importAsks(swept)
    await readTeam(io, peers)
    await announce(io, created)
    await dispatch()
    await writeTeam(swept, written)
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

  const task = async (to: Peer | RoleId, brief: Brief & { after?: string }): Promise<Result> => {
    const text = brief.text.trim()
    if (text === '') return { ok: false, text: 'type the task first' }
    const roster = await io.state.roster.get()
    const queued = queuedOf(newTaskId(), { ...brief, text }, await io.now())
    if (typeof to === 'string') {
      if (!Object.values(roster).some(h => h.role === to)) return note(false, `no ${to} member on the team; hire one with fleet_hire`)
      await io.state.pool.set(pool => [...pool, { ...queued, role: to }])
      const why = (await serial(() => handOut(io))).get(queued.id)
      if (why !== undefined) return { ok: false, text: `${why}; task ${queued.id} stays in the pool` }
      return placed(io, queued.id)
    }
    if (roster[to.id] === undefined) return note(false, `${to.name} is not on the team`)
    await io.state.roster.set(r => withQueued(r, to.id, queued))
    const out = await sendNext(to.id)
    if (out !== null && 'why' in out) return { ok: false, text: `could not reach ${to.name}: ${out.why}; task ${queued.id} stays queued` }
    return placed(io, queued.id)
  }

  const cancel = async (peer: Member, taskId?: string): Promise<Result> => {
    const hire = (await io.state.roster.get())[peer.id]
    if (hire === undefined) return note(false, `${peer.name} is not on the team`)
    if (taskId !== undefined && (hire.queue ?? []).some(q => q.id === taskId)) {
      await io.state.roster.set(roster => withoutQueued(roster, peer.id, taskId))
      return note(true, `took task ${taskId} off the queue for ${peer.name}`)
    }
    const open = hire.task
    if (taskId !== undefined && open?.id !== taskId) return note(false, `${peer.name} has no task ${taskId}`)
    if (open === undefined || (open.status !== 'sent' && open.status !== 'blocked')) return note(false, `${peer.name} has no open task`)
    const why = await io.send(peer.id, cancelMessage(open.id))
    const endedAt = await io.now()
    await io.state.roster.set(roster => markTask(roster, peer.id, { status: 'cancelled', endedAt }))
    io.forget(peer.dir, peer.id, open.sentAt)
    await dispatch()
    if (why !== null) return note(false, `cancelled task ${open.id} for ${peer.name}, but could not tell it: ${why}`)
    return note(true, `cancelled task ${open.id} for ${peer.name}`)
  }

  const cancelById = async (taskId: string): Promise<Result> => {
    if ((await io.state.pool.get()).some(p => p.id === taskId)) {
      await io.state.pool.set(pool => pool.filter(p => p.id !== taskId))
      return note(true, `took task ${taskId} off the pool`)
    }
    const holder = Object.entries(await io.state.roster.get()).find(([, h]) => h.task?.id === taskId || (h.queue ?? []).some(q => q.id === taskId))
    if (holder === undefined) return note(false, `no task ${taskId} on the team`)
    const [id, hire] = holder
    return cancel({ id, name: hire.name, dir: hire.dir }, taskId)
  }

  return {
    refresh,
    task,
    cancel,
    cancelById,
    brief: (peer: Peer, role: Role) => brief(io, peer, role),
    drop: (peer: Peer) => drop(io, misses, peer),
    setRole: (peer: Peer, role: Role) => setRole(io, peer, role),
    note,
    outside: (): readonly Peer[] => outside,
  }
}

export type Fleet = ReturnType<typeof createFleet>
