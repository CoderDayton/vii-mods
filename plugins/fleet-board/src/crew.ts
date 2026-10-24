import { fmtAge } from './peers'
import { roleOf } from './roles'
import { hireKey, isObject, parseEmployment, parseTeam, roleLabel, teamKey } from './team'
import { lineOf } from './transcript'
import type { Hire, RoleId } from '../types'

export type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export type Post = { name: string; text: string; at: number }

export type Message = { from: string; fromName: string; toName: string; text: string; at: number }

export type TaskAsk = {
  from: string
  fromName: string
  session?: string
  role?: RoleId
  text: string
  scope?: string
  done?: string
  after?: string
  at: number
}

export const MESSAGES_KEPT = 20

export const postKey = (bossId: string, memberId: string): string => `post:${bossId}:${memberId}`

export const messageKey = (bossId: string, at: number, from: string): string => `msg:${bossId}:${at}:${from}`

export const askKey = (bossId: string, taskId: string): string => `ask:${bossId}:${taskId}`

export const teamDir = (runtimeDir: string | undefined, home: string | undefined): string =>
  runtimeDir !== undefined && runtimeDir !== '' ? `${runtimeDir}/fleet-board` : `${home ?? ''}/.cache/fleet-board`

export const teamFile = (dir: string, bossId: string): string => `${dir}/team-${bossId}.md`

export const fileKey = (bossId: string): string => `file:${bossId}`

export const publishedFile = async (store: Store, bossId: string, fallback: string): Promise<string> => {
  const path = await store.get(fileKey(bossId))
  return typeof path === 'string' && path !== '' ? path : fallback
}

const str = (o: Record<string, unknown>, key: string): string | undefined => (typeof o[key] === 'string' ? (o[key] as string) : undefined)

const num = (o: Record<string, unknown>, key: string): number | undefined => (typeof o[key] === 'number' ? (o[key] as number) : undefined)

const parsePost = (v: unknown): Post | null => {
  if (!isObject(v)) return null
  const name = str(v, 'name')
  const text = str(v, 'text')
  const at = num(v, 'at')
  return name === undefined || text === undefined || at === undefined ? null : { name, text, at }
}

const parseMessage = (v: unknown): Message | null => {
  if (!isObject(v)) return null
  const [from, fromName, toName, text, at] = [str(v, 'from'), str(v, 'fromName'), str(v, 'toName'), str(v, 'text'), num(v, 'at')]
  if (from === undefined || fromName === undefined || toName === undefined || text === undefined || at === undefined) return null
  return { from, fromName, toName, text, at }
}

const parseAsk = (v: unknown): TaskAsk | null => {
  if (!isObject(v)) return null
  const [from, fromName, text, at] = [str(v, 'from'), str(v, 'fromName'), str(v, 'text'), num(v, 'at')]
  if (from === undefined || fromName === undefined || text === undefined || at === undefined) return null
  const session = str(v, 'session')
  const role = roleOf(str(v, 'role') ?? '')?.id
  if ((session === undefined) === (role === undefined)) return null
  const optional = Object.fromEntries((['scope', 'done', 'after'] as const).flatMap(k => (str(v, k) === undefined ? [] : [[k, str(v, k)]])))
  return { from, fromName, text, at, ...(session === undefined ? {} : { session }), ...(role === undefined ? {} : { role }), ...optional }
}

const withPrefix = async (store: Store, prefix: string): Promise<string[]> => (await store.keys()).filter(k => k.startsWith(prefix))

export const postsOf = async (store: Store, bossId: string): Promise<Record<string, Post>> => {
  const prefix = `post:${bossId}:`
  const out: Record<string, Post> = {}
  for (const key of await withPrefix(store, prefix)) {
    const post = parsePost(await store.get(key))
    if (post !== null) out[key.slice(prefix.length)] = post
  }
  return out
}

export const messagesOf = async (store: Store, bossId: string): Promise<Array<{ key: string; message: Message }>> => {
  const out: Array<{ key: string; message: Message }> = []
  for (const key of await withPrefix(store, `msg:${bossId}:`)) {
    const message = parseMessage(await store.get(key))
    if (message !== null) out.push({ key, message })
  }
  return out.sort((a, b) => a.message.at - b.message.at)
}

export const asksOf = async (store: Store, bossId: string): Promise<Array<{ id: string; ask: TaskAsk | null }>> => {
  const prefix = `ask:${bossId}:`
  const out: Array<{ id: string; ask: TaskAsk | null }> = []
  for (const key of await withPrefix(store, prefix)) out.push({ id: key.slice(prefix.length), ask: parseAsk(await store.get(key)) })
  return out
}

export const trimMessages = async (store: Store, bossId: string): Promise<void> => {
  const all = await messagesOf(store, bossId)
  for (const { key } of all.slice(0, Math.max(0, all.length - MESSAGES_KEPT))) await store.delete(key)
}

export const keyedOnce = (store: Store): Store => {
  let keys: Promise<Set<string>> | null = null
  const loaded = (): Promise<Set<string>> => (keys ??= store.keys().then(list => new Set(list)))
  return {
    get: key => store.get(key),
    set: async (key, value) => {
      await store.set(key, value)
      ;(await loaded()).add(key)
    },
    delete: async key => {
      await store.delete(key)
      ;(await loaded()).delete(key)
    },
    keys: async () => [...(await loaded())],
  }
}

export const renamedKey = (bossId: string, oldId: string): string => `renamed:${bossId}:${oldId}`

const BOSS_KINDS = new Set(['team', 'pool', 'post', 'msg', 'ask', 'renamed'])

const moveKey = async (store: Store, from: string, to: string): Promise<void> => {
  const value = await store.get(from)
  if (value === undefined) return
  await store.set(to, value)
  await store.delete(from)
}

export const moveSession = async (store: Store, from: string, to: string): Promise<void> => {
  const team = await store.get(teamKey(from))
  await store.delete(fileKey(from))
  for (const key of await store.keys()) {
    const [kind = '', boss, ...rest] = key.split(':')
    if (boss !== from || !BOSS_KINDS.has(kind)) continue
    const tail = kind === 'post' && rest[0] === from ? [to] : rest
    await moveKey(store, key, [kind, to, ...tail].join(':'))
  }
  for (const id of Object.keys(parseTeam(team))) {
    const job = parseEmployment(await store.get(hireKey(id)))
    if (job?.bossId === from) await store.set(hireKey(id), { ...job, bossId: to })
  }
  const job = parseEmployment(await store.get(hireKey(from)))
  if (job === null) return
  await moveKey(store, hireKey(from), hireKey(to))
  await moveKey(store, postKey(job.bossId, from), postKey(job.bossId, to))
  await store.set(renamedKey(job.bossId, from), to)
}

export const renamesOf = async (store: Store, bossId: string): Promise<Array<{ from: string; to: string }>> => {
  const prefix = renamedKey(bossId, '')
  const out: Array<{ from: string; to: string }> = []
  for (const key of await store.keys()) {
    if (!key.startsWith(prefix)) continue
    const to = await store.get(key)
    if (typeof to === 'string') out.push({ from: key.slice(prefix.length), to })
  }
  return out
}

export const boardLines = (bossId: string, team: Readonly<Record<string, Hire>>, posts: Readonly<Record<string, Post>>, now: number, self?: string): string[] => {
  const goal = posts[bossId]
  const lines = goal === undefined ? [] : [`Goal: ${lineOf(goal.text)}`]
  for (const [id, post] of Object.entries(posts)) {
    if (id === bossId || team[id] === undefined) continue
    const age = fmtAge(now - post.at)
    lines.push(`- ${post.name}${id === self ? ' (you)' : ''}: ${lineOf(post.text)} (${age === 'now' ? age : `${age} ago`})`)
  }
  return lines.length === 0 ? [] : ['', 'Board:', ...lines]
}

export const renderTeamFile = (
  bossId: string,
  bossName: string,
  team: Readonly<Record<string, Hire>>,
  posts: Readonly<Record<string, Post>>,
  messages: readonly Message[],
): string => {
  const goal = posts[bossId]
  const members = Object.entries(team).map(([id, hire]) => {
    const post = posts[id]
    const task = hire.task === undefined ? '' : ` · task ${hire.task.id} ${hire.task.status}`
    return `- ${hire.name} (${roleLabel(hire.role)})${post === undefined ? ': nothing posted yet' : `: ${lineOf(post.text)}`}${task}`
  })
  return [
    `# ${bossName}'s team`,
    '',
    `Goal: ${goal === undefined ? 'not set yet' : goal.text}`,
    '',
    '## Working on',
    '',
    ...(members.length === 0 ? ['- nobody yet'] : members),
    '',
    '## Messages',
    '',
    ...(messages.length === 0 ? ['- none yet'] : messages.map(m => `- ${m.fromName} → ${m.toName}: ${lineOf(m.text)}`)),
    '',
  ].join('\n')
}
