import type { ToolCallResult } from 'claude-code'

import type { Fleet } from './fleet'
import type { Peer } from './peers'
import { resolvePeer } from './peers'
import { roleOf, ROLES } from './roles'
import { teamStatus } from './team'
import type { Hire } from './team'
import type { Employment, PooledTask } from '../types'

// The fleet tools the boss calls. The model names each one mcp__fleet-board__<name>.
export const TOOL_PREFIX = 'mcp__fleet-board__'

const ROLE_LIST = ROLES.map(r => r.id).join(', ').replace(/, ([^,]*)$/, ' or $1')

const SESSION = {
  type: 'string',
  description: 'The session by its number in the pane, its name, its folder name, or the start of its name.',
}

const ROLE = { type: 'string', enum: ROLES.map(r => r.id), description: `One of: ${ROLE_LIST}.` }

export const TOOL_SPECS = [
  {
    name: 'fleet_hire',
    description: 'Add a Claude session to your team and brief it for a role. Its replies are tracked on the team.',
    inputSchema: {
      type: 'object',
      properties: { session: SESSION, role: ROLE },
      required: ['session', 'role'],
    },
    isDeferred: false,
  },
  {
    name: 'fleet_task',
    description:
      'Send one task to a member of your team, or to a role: the member of that role that is free first takes it. A member works one task at a time: a task for a busy member, or one whose after task is not done, is queued and sent when it can be. Its reply is read with fleet_status.',
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION,
        role: { ...ROLE, description: `Instead of session: give the task to whichever member of this role is free first. ${ROLE.description}` },
        text: { type: 'string', description: 'The goal: what to do and why.' },
        scope: { type: 'string', description: 'What to touch and what to leave alone.' },
        done: { type: 'string', description: 'What done looks like: the check that proves it.' },
        after: { type: 'string', description: 'A task id on the team that must be done before this task is sent.' },
      },
      required: ['text'],
    },
    isDeferred: false,
  },
  {
    name: 'fleet_cancel',
    description:
      "Cancel a member's open task and tell it, or take a queued task off its queue. With a task id and no session, find that task anywhere on the team or in the pool. The next queued task is then sent.",
    inputSchema: {
      type: 'object',
      properties: { session: SESSION, task: { type: 'string', description: 'The task id; the open task when left out.' } },
    },
    isDeferred: false,
  },
  {
    name: 'fleet_drop',
    description: 'Take a member off your team and tell it.',
    inputSchema: { type: 'object', properties: { session: SESSION }, required: ['session'] },
    isDeferred: false,
  },
  {
    name: 'fleet_status',
    description: 'Show your team: each member, its role, whether it has replied, its task id and status, and its last reply.',
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  },
] as const

export type ToolName = (typeof TOOL_SPECS)[number]['name']

export type ToolReply = { text: string; isError: boolean }

export type ToolDeps = {
  fleet: Fleet
  roster: () => Promise<Readonly<Record<string, Hire>>>
  pool: () => Promise<readonly PooledTask[]>
  now: () => Promise<number>
  selfId: () => Promise<string>
  employment: (sessionId: string) => Promise<Employment | null>
}

type Input = Readonly<Record<string, unknown>>

const reply = (text: string, isError = false): ToolReply => ({ text, isError })

const fromResult = (out: { ok: boolean; text: string }): ToolReply => reply(out.text, !out.ok)

const argOf = (input: Input, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

const optionalArg = (input: Input, key: string): Record<string, string> => {
  const value = argOf(input, key)
  return value === '' ? {} : { [key]: value }
}

const hasTask = (roster: Readonly<Record<string, Hire>>, pool: readonly PooledTask[], id: string): boolean =>
  pool.some(p => p.id === id) ||
  Object.values(roster).some(h => h.task?.id === id || (h.queue ?? []).some(q => q.id === id) || (h.history ?? []).some(t => t.id === id))

// Runs one fleet tool. Bad input returns an error text and changes nothing. A throw becomes an error text that names
// the tool and the message.
export const runTool = async (name: ToolName, input: Input, deps: ToolDeps): Promise<ToolReply> => {
  try {
    return await TOOLS[name](input, deps)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return reply(`fleet-board could not run ${name}: ${why}`, true)
  }
}

const peerOf = async (input: Input, { fleet }: ToolDeps): Promise<Peer | string> => {
  const session = argOf(input, 'session')
  if (session === '') return 'name a session: its number, its name or its folder name'
  const found = resolvePeer(await fleet.refresh(), session)
  if ('peer' in found) return found.peer
  const hidden = resolvePeer(fleet.outside(), session)
  return 'peer' in hidden ? `${hidden.peer.name} is outside this project's root` : found.error
}

const liveBoss = async (deps: ToolDeps, sessionId: string): Promise<Employment | null> => {
  const job = await deps.employment(sessionId)
  if (job === null) return null
  const running = [...(await deps.fleet.refresh()), ...deps.fleet.outside()]
  return running.some(p => p.id === job.bossId) ? job : null
}

const withPeer = (run: (peer: Peer, input: Input, deps: ToolDeps) => Promise<ToolReply>) => async (input: Input, deps: ToolDeps): Promise<ToolReply> => {
  const peer = await peerOf(input, deps)
  return typeof peer === 'string' ? reply(peer, true) : run(peer, input, deps)
}

const TOOLS: Record<ToolName, (input: Input, deps: ToolDeps) => Promise<ToolReply>> = {
  fleet_status: async (_input, deps) => {
    await deps.fleet.refresh()
    return reply(teamStatus(await deps.roster(), await deps.now(), await deps.pool()))
  },

  fleet_hire: async (input, deps) => {
    const role = roleOf(argOf(input, 'role'))
    if (role === undefined) return reply(`unknown role "${argOf(input, 'role')}"; use ${ROLE_LIST}`, true)
    return withPeer(async peer => {
      if ((await deps.roster())[peer.id] !== undefined) return reply(`${peer.name} is already on the team; fleet_drop it first`, true)
      const self = await deps.selfId()
      const mine = await liveBoss(deps, self)
      if (mine !== null) return reply(`you are on ${mine.bossName}'s team, so you cannot hire; ask ${mine.bossName} to hire ${peer.name}`, true)
      const theirs = await liveBoss(deps, peer.id)
      if (theirs !== null && theirs.bossId !== self) return reply(`${peer.name} is on ${theirs.bossName}'s team; ${theirs.bossName} must drop it first`, true)
      return fromResult(await deps.fleet.brief(peer, role))
    })(input, deps)
  },

  fleet_task: async (input, deps) => {
    const text = argOf(input, 'text')
    if (text === '') return reply('type the task first', true)
    const hasSession = argOf(input, 'session') !== ''
    const roleName = argOf(input, 'role')
    if (hasSession && roleName !== '') return reply('name a session or a role, not both', true)
    if (!hasSession && roleName === '') return reply('name a session or a role', true)
    const after = argOf(input, 'after')
    if (after !== '' && !hasTask(await deps.roster(), await deps.pool(), after)) return reply(`no task ${after} on the team`, true)
    const brief = { text, ...optionalArg(input, 'scope'), ...optionalArg(input, 'done'), ...optionalArg(input, 'after') }
    if (!hasSession) {
      const role = roleOf(roleName)
      if (role === undefined) return reply(`unknown role "${roleName}"; use ${ROLE_LIST}`, true)
      await deps.fleet.refresh()
      return fromResult(await deps.fleet.task(role.id, brief))
    }
    return withPeer(async peer => {
      if ((await deps.roster())[peer.id] === undefined) return reply(`${peer.name} is not on the team; hire it first with fleet_hire`, true)
      return fromResult(await deps.fleet.task(peer, brief))
    })(input, deps)
  },

  fleet_cancel: async (input, deps) => {
    const task = argOf(input, 'task')
    if (argOf(input, 'session') === '' && task !== '') return fromResult(await deps.fleet.cancelById(task))
    return withPeer(async peer => fromResult(await deps.fleet.cancel(peer, task === '' ? undefined : task)))(input, deps)
  },

  fleet_drop: withPeer(async (peer, _input, deps) => fromResult(await deps.fleet.drop(peer))),
}

// The answer of a tool.call hook for a fleet tool. The engine takes a tool's output as a string, an array or undefined,
// so the text is the result. An error is marked isError, with its text as the result and as the text the model reads.
export const asToolResult = (out: ToolReply): ToolCallResult =>
  out.isError ? { isError: true, result: out.text, text: out.text } : { result: out.text }
