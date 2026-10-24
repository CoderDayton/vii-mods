import type { Peer } from './peers'
import { noticeOf } from './team'
import type { Brief, Hire, PooledTask, QueuedTask, Task } from '../types'

export type Roster = Record<string, Hire>

const HISTORY_KEPT = 5

export const without = (roster: Roster, id: string): Roster => Object.fromEntries(Object.entries(roster).filter(([key]) => key !== id))

const withHire = (roster: Roster, id: string, change: (hire: Hire) => Hire): Roster => {
  const hire = roster[id]
  return hire === undefined ? roster : { ...roster, [id]: change(hire) }
}

const withLists = (hire: Hire, queue: QueuedTask[], history: Task[]): Hire => {
  const { queue: _queue, history: _history, ...rest } = hire
  return { ...rest, ...(queue.length === 0 ? {} : { queue }), ...(history.length === 0 ? {} : { history }) }
}

export const markTask = (roster: Roster, id: string, patch: Partial<Task>): Roster =>
  withHire(roster, id, hire => (hire.task === undefined ? hire : { ...hire, task: { ...hire.task, ...patch } }))

export const markEarlier = (roster: Roster, id: string, taskId: string, patch: Partial<Task>): Roster =>
  withHire(roster, id, hire => (hire.history === undefined ? hire : { ...hire, history: hire.history.map(t => (t.id === taskId ? { ...t, ...patch } : t)) }))

export const markReady = (roster: Roster, id: string, at: number): Roster => withHire(roster, id, hire => ({ ...hire, readyAt: at }))

const withStuck = <T extends QueuedTask>(entry: T, stuck: string | null): T => {
  const { stuck: _stuck, ...rest } = entry
  return (stuck === null ? rest : { ...rest, stuck }) as T
}

const markQueued = (roster: Roster, id: string, taskId: string, stuck: string | null): Roster =>
  withHire(roster, id, hire => (hire.queue === undefined ? hire : { ...hire, queue: hire.queue.map(q => (q.id === taskId ? withStuck(q, stuck) : q)) }))

export const withQueued = (roster: Roster, id: string, queued: QueuedTask): Roster =>
  withHire(roster, id, hire => withLists(hire, [...(hire.queue ?? []), queued], hire.history ?? []))

export const withoutQueued = (roster: Roster, id: string, taskId: string): Roster =>
  withHire(roster, id, hire => withLists(hire, (hire.queue ?? []).filter(q => q.id !== taskId), hire.history ?? []))

export const queuedOf = (id: string, brief: Brief & { after?: string }, queuedAt: number): QueuedTask => ({
  id,
  text: brief.text,
  ...(brief.scope === undefined ? {} : { scope: brief.scope }),
  ...(brief.done === undefined ? {} : { done: brief.done }),
  ...(brief.after === undefined ? {} : { after: brief.after }),
  queuedAt,
})

const waitedOn = (roster: Readonly<Roster>, pool: readonly PooledTask[]): Set<string> =>
  new Set([...Object.values(roster).flatMap(h => h.queue ?? []), ...pool].flatMap(q => (q.after === undefined ? [] : [q.after])))

const trimHistory = (history: Task[], kept: Set<string>): Task[] => {
  let extra = history.length - HISTORY_KEPT
  return history.filter(t => {
    if (extra <= 0 || kept.has(t.id)) return true
    extra -= 1
    return false
  })
}

export const startTask = (roster: Roster, pool: readonly PooledTask[], id: string, head: QueuedTask, sentAt: number): Roster =>
  withHire(roster, id, hire => {
    const { after: _after, queuedAt: _queuedAt, stuck: _stuck, ...brief } = head
    const kept = waitedOn(withoutQueued(roster, id, head.id), pool)
    const history = hire.task === undefined ? (hire.history ?? []) : trimHistory([...(hire.history ?? []), hire.task], kept)
    const queue = (hire.queue ?? []).filter(q => q.id !== head.id)
    return withLists({ ...hire, task: { ...brief, sentAt, status: 'sent' } }, queue, history)
  })

const tasksOf = (roster: Readonly<Roster>): Task[] =>
  Object.values(roster).flatMap(h => [...(h.task === undefined ? [] : [h.task]), ...(h.history ?? [])])

export const isDone = (roster: Readonly<Roster>, taskId: string): boolean => tasksOf(roster).some(t => t.id === taskId && t.status === 'done')

const whyStuck = (roster: Readonly<Roster>, pool: readonly PooledTask[], taskId: string): string | null => {
  const task = tasksOf(roster).find(t => t.id === taskId)
  if (task !== undefined) return task.status === 'cancelled' ? 'was cancelled' : null
  const waiting = [...Object.values(roster).flatMap(h => h.queue ?? []), ...pool].some(q => q.id === taskId)
  return waiting ? null : 'is no longer on the team'
}

export const holdOf = (roster: Readonly<Roster>, peers: readonly Peer[], id: string, entry: QueuedTask): string | null => {
  const hire = roster[id]
  if (hire === undefined) return 'until it is on the team'
  if (entry.after !== undefined && !isDone(roster, entry.after)) return `after task ${entry.after}`
  const queue = hire.queue ?? []
  const at = queue.findIndex(q => q.id === entry.id)
  const ahead = (at === -1 ? queue : queue.slice(0, at)).at(-1)
  if (ahead !== undefined) return `behind task ${ahead.id}`
  if (hire.task?.status === 'sent') return `behind task ${hire.task.id}`
  return peers.some(p => p.id === id) ? null : 'until its session is back'
}

const freeSince = (hire: Hire): number => hire.task?.endedAt ?? hire.readyAt ?? hire.briefedAt

export const takerOf = (roster: Readonly<Roster>, peers: readonly Peer[], entry: PooledTask, skip: ReadonlySet<string>): string | null =>
  Object.entries(roster)
    .filter(([id, hire]) => hire.role === entry.role && hire.readyAt !== undefined && !skip.has(id) && holdOf(roster, peers, id, entry) === null)
    .sort(([, a], [, b]) => freeSince(a) - freeSince(b))[0]?.[0] ?? null

export type Notice = {
  name: string
  text: string | null
  roster?: (roster: Roster) => Roster
  pool?: (pool: PooledTask[]) => PooledTask[]
}

const STUCK_TAIL = 'Cancel it with fleet_cancel, or send it again without after.'

export const noticesOf = (roster: Readonly<Roster>, pool: readonly PooledTask[], now: number): Notice[] => {
  const out: Notice[] = []
  for (const [id, hire] of Object.entries(roster)) {
    const announce = (task: Task, mark: (r: Roster, key: string) => Roster): void => {
      const notice = noticeOf(hire.name, task, now)
      if (notice !== null && task.announced !== notice.key) out.push({ name: hire.name, text: notice.text, roster: r => mark(r, notice.key) })
    }
    if (hire.task !== undefined) announce(hire.task, (r, key) => markTask(r, id, { announced: key }))
    for (const t of hire.history ?? []) announce(t, (r, key) => markEarlier(r, id, t.id, { announced: key }))
    for (const q of hire.queue ?? []) {
      const why = q.after === undefined ? null : whyStuck(roster, pool, q.after)
      if ((q.stuck ?? null) === why) continue
      if (why === null) {
        out.push({ name: hire.name, text: null, roster: r => markQueued(r, id, q.id, null) })
        continue
      }
      const text = `${hire.name}: queued task ${q.id} waits on task ${q.after}, which ${why}. ${STUCK_TAIL}`
      out.push({ name: hire.name, text, roster: r => markQueued(r, id, q.id, why) })
    }
  }
  for (const p of pool) {
    const after = p.after === undefined ? null : whyStuck(roster, pool, p.after)
    const why = after ?? (Object.values(roster).some(h => h.role === p.role) ? null : 'no member')
    if ((p.stuck ?? null) === why) continue
    const mark = (list: PooledTask[]): PooledTask[] => list.map(one => (one.id === p.id ? withStuck(one, why) : one))
    if (why === null) {
      out.push({ name: 'the pool', text: null, pool: mark })
      continue
    }
    const text =
      after === null
        ? `queued task ${p.id} waits for a ${p.role} member, and the team has none. Hire one with fleet_hire, or cancel it with fleet_cancel.`
        : `queued task ${p.id} for the next free ${p.role} member waits on task ${p.after}, which ${after}. ${STUCK_TAIL}`
    out.push({ name: 'the pool', text, pool: mark })
  }
  return out
}
