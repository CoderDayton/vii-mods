import { isInside, parsePeers, SCAN_ARGV } from './peers'
import type { Peer } from './peers'
import { briefing, cancelMessage, DROP, taskMessage } from './roles'
import type { Role } from './roles'
import { bossLabel, hireKey, noticeOf } from './team'
import type { Brief, Hire, Note, QueuedTask, Task } from '../types'
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

const HISTORY_KEPT = 5

// A member is dropped after this many scans in a row without its registry line. One missing scan can be a
// registry file caught mid-write.
const MISSES_BEFORE_DROP = 3

// A six-character id for a task, which the employee's reply echoes.
const newTaskId = (): string => Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')

const without = (roster: Record<string, Hire>, id: string): Record<string, Hire> =>
  Object.fromEntries(Object.entries(roster).filter(([key]) => key !== id))

const markTask = (roster: Record<string, Hire>, id: string, patch: Partial<Task>): Record<string, Hire> => {
  const hire = roster[id]
  return hire?.task === undefined ? roster : { ...roster, [id]: { ...hire, task: { ...hire.task, ...patch } } }
}

const withLists = (hire: Hire, queue: QueuedTask[], history: Task[]): Hire => {
  const { queue: _queue, history: _history, ...rest } = hire
  return { ...rest, ...(queue.length === 0 ? {} : { queue }), ...(history.length === 0 ? {} : { history }) }
}

const withQueued = (roster: Record<string, Hire>, id: string, queued: QueuedTask): Record<string, Hire> => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: withLists(hire, [...(hire.queue ?? []), queued], hire.history ?? []) }
}

const withoutQueued = (roster: Record<string, Hire>, id: string, taskId: string): Record<string, Hire> => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: withLists(hire, (hire.queue ?? []).filter(q => q.id !== taskId), hire.history ?? []) }
}

const trimHistory = (roster: Readonly<Record<string, Hire>>, history: Task[], started: string): Task[] => {
  const waitedOn = new Set(
    Object.values(roster).flatMap(h => (h.queue ?? []).flatMap(q => (q.id === started || q.after === undefined ? [] : [q.after]))),
  )
  let extra = history.length - HISTORY_KEPT
  return history.filter(t => {
    if (extra <= 0 || waitedOn.has(t.id)) return true
    extra -= 1
    return false
  })
}

const startTask = (roster: Record<string, Hire>, id: string, head: QueuedTask, sentAt: number): Record<string, Hire> => {
  const hire = roster[id]
  if (hire === undefined) return roster
  const { after: _after, queuedAt: _queuedAt, stuck: _stuck, ...brief } = head
  const history = hire.task === undefined ? (hire.history ?? []) : trimHistory(roster, [...(hire.history ?? []), hire.task], head.id)
  const queue = (hire.queue ?? []).filter(q => q.id !== head.id)
  return { ...roster, [id]: withLists({ ...hire, task: { ...brief, sentAt, status: 'sent' } }, queue, history) }
}

const isDone = (roster: Readonly<Record<string, Hire>>, taskId: string): boolean =>
  Object.values(roster).some(h => h.task?.id === taskId ? h.task.status === 'done' : (h.history ?? []).some(t => t.id === taskId && t.status === 'done'))

const markEarlier = (roster: Record<string, Hire>, id: string, taskId: string, patch: Partial<Task>): Record<string, Hire> => {
  const hire = roster[id]
  if (hire?.history === undefined) return roster
  return { ...roster, [id]: { ...hire, history: hire.history.map(t => (t.id === taskId ? { ...t, ...patch } : t)) } }
}

const markStuck = (roster: Record<string, Hire>, id: string, taskId: string, stuck: string): Record<string, Hire> => {
  const hire = roster[id]
  if (hire?.queue === undefined) return roster
  return { ...roster, [id]: { ...hire, queue: hire.queue.map(q => (q.id === taskId ? { ...q, stuck } : q)) } }
}

const whyStuck = (roster: Readonly<Record<string, Hire>>, taskId: string): string | null => {
  const hires = Object.values(roster)
  const task = hires.flatMap(h => [...(h.task === undefined ? [] : [h.task]), ...(h.history ?? [])]).find(t => t.id === taskId)
  if (task !== undefined) return task.status === 'cancelled' ? 'was cancelled' : null
  return hires.some(h => (h.queue ?? []).some(q => q.id === taskId)) ? null : 'is no longer on the team'
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

type Pending = { name: string; text: string; mark: (roster: Record<string, Hire>) => Record<string, Hire> }

const noticesOf = (roster: Readonly<Record<string, Hire>>, now: number): Pending[] =>
  Object.entries(roster).flatMap(([id, hire]) => {
    const out: Pending[] = []
    const task = hire.task === undefined ? null : noticeOf(hire.name, hire.task, now)
    if (task !== null && hire.task?.announced !== task.key) {
      out.push({ name: hire.name, text: task.text, mark: r => markTask(r, id, { announced: task.key }) })
    }
    for (const earlier of hire.history ?? []) {
      const notice = noticeOf(hire.name, earlier, now)
      if (notice === null || earlier.announced === notice.key) continue
      out.push({ name: hire.name, text: notice.text, mark: r => markEarlier(r, id, earlier.id, { announced: notice.key }) })
    }
    for (const q of hire.queue ?? []) {
      const why = q.after === undefined ? null : whyStuck(roster, q.after)
      if (why === null || q.stuck === why) continue
      const text = `${hire.name}: queued task ${q.id} waits on task ${q.after}, which ${why}. Cancel it with fleet_cancel, or send it again without after.`
      out.push({ name: hire.name, text, mark: r => markStuck(r, id, q.id, why) })
    }
    return out
  })

export const createFleet = (io: Io) => {
  const note = async (ok: boolean, text: string): Promise<Result> => {
    const at = await io.now()
    await io.state.notes.set(notes => [...notes, { ok, text, at }].slice(-NOTES_KEPT))
    return { ok, text }
  }

  // The sessions the last scan found outside the boss's folder. Not listed, but named in the error when one is hired.
  let outside: Peer[] = []

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
    const everyone = scanned
      .filter(p => p.id !== self)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    // Only the boss's own project: its folder and what is inside it. Team members stay wherever they are, and
    // without an entry for the boss nothing is hidden.
    const root = mine?.dir ?? ''
    const roster = await io.state.roster.get()
    const peers = everyone.filter(p => root === '' || isInside(p.dir, root) || roster[p.id] !== undefined)
    outside = everyone.filter(p => !peers.includes(p))
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
      if (peer === undefined) continue
      const task = hire.task
      if (task !== undefined && (task.status === 'sent' || task.status === 'blocked')) await readTask(io, peer, id, task)
      for (const earlier of hire.history ?? []) if (earlier.status === 'blocked') await readEarlier(io, peer, id, earlier)
    }
    const pending = noticesOf(await io.state.roster.get(), now)
    if (pending.length > 0) {
      try {
        await io.prompt(pending.map(p => p.text).join('\n\n'))
        for (const p of pending) await io.state.roster.set(p.mark)
      } catch (error) {
        const names = pending.map(p => p.name).join(', ')
        await note(false, `could not tell the boss about ${names}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const id of Object.keys(await io.state.roster.get())) await sendNext(id)
    return peers
  }

  type Sent = { sent: string } | { why: string } | null
  let sending: Promise<unknown> = Promise.resolve()
  const sendNext = (id: string): Promise<Sent> => {
    const run = sending.then(() => sendHead(id))
    sending = run.catch(() => undefined)
    return run
  }

  const sendHead = async (id: string): Promise<Sent> => {
    const roster = await io.state.roster.get()
    const hire = roster[id]
    const head = hire?.queue?.[0]
    if (hire === undefined || head === undefined) return null
    const task = hire.task
    if (task !== undefined) {
      const notice = noticeOf(hire.name, task, await io.now())
      if (task.status === 'sent' || (notice !== null && task.announced !== notice.key)) return null
    }
    if (head.after !== undefined && !isDone(roster, head.after)) return null
    if (!(await io.state.peers.get()).some(p => p.id === id)) return null
    const why = await io.send(id, taskMessage(await io.state.boss.get(), head.id, head))
    if (why !== null) {
      await note(false, `could not reach ${hire.name}: ${why}`)
      return { why }
    }
    const sentAt = await io.now()
    await io.state.roster.set(r => startTask(r, id, head, sentAt))
    const kept = new Set(((await io.state.roster.get())[id]?.history ?? []).map(t => t.id))
    for (const old of [...(hire.history ?? []), ...(task === undefined ? [] : [task])]) {
      if (old.status === 'blocked' && !kept.has(old.id)) io.forget(hire.dir, id, old.sentAt)
    }
    return { sent: head.id }
  }

  // Callers that arrive while a sweep runs share its result, so two sweeps never announce the same notice.
  let running: Promise<Peer[]> | undefined
  const refresh = (): Promise<Peer[]> => {
    running ??= sweep().finally(() => {
      running = undefined
    })
    return running
  }

  const task = async (peer: Peer, brief: Brief & { after?: string }): Promise<Result> => {
    const text = brief.text.trim()
    if (text === '') return { ok: false, text: 'type the task first' }
    if ((await io.state.roster.get())[peer.id] === undefined) return note(false, `${peer.name} is not on the team`)
    const id = newTaskId()
    const queued: QueuedTask = {
      id,
      text,
      ...(brief.scope === undefined ? {} : { scope: brief.scope }),
      ...(brief.done === undefined ? {} : { done: brief.done }),
      ...(brief.after === undefined ? {} : { after: brief.after }),
      queuedAt: await io.now(),
    }
    await io.state.roster.set(roster => withQueued(roster, peer.id, queued))
    const out = await sendNext(peer.id)
    if (out !== null && 'sent' in out && out.sent === id) return note(true, `sent ${peer.name} task ${id}`)
    if (out !== null && 'why' in out) return { ok: false, text: `could not reach ${peer.name}: ${out.why}; task ${id} stays queued` }
    const roster = await io.state.roster.get()
    const hire = roster[peer.id]
    const ahead = (hire?.queue ?? []).slice(0, (hire?.queue ?? []).findIndex(q => q.id === id))
    const reason =
      queued.after !== undefined && !isDone(roster, queued.after)
        ? `after task ${queued.after}`
        : `behind task ${ahead.at(-1)?.id ?? hire?.task?.id ?? ''}`
    return note(true, `queued task ${id} for ${peer.name}, ${reason}`)
  }

  const cancel = async (peer: Peer, taskId?: string): Promise<Result> => {
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
    await sendNext(peer.id)
    if (why !== null) return note(false, `cancelled task ${open.id} for ${peer.name}, but could not tell it: ${why}`)
    return note(true, `cancelled task ${open.id} for ${peer.name}`)
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

  return { refresh, task, cancel, brief, drop, note, outside: (): readonly Peer[] => outside }
}

export type Fleet = ReturnType<typeof createFleet>
