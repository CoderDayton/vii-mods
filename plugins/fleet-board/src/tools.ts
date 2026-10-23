import type { ToolCallResult } from 'claude-code'

import type { Fleet } from './fleet'
import { resolvePeer } from './peers'
import { roleOf, ROLES } from './roles'
import { teamStatus } from './team'
import type { Hire } from './team'

// The fleet tools the boss calls. The model names each one mcp__fleet-board__<name>.
export const TOOL_PREFIX = 'mcp__fleet-board__'

const ROLE_LIST = ROLES.map(r => r.id).join(', ').replace(/, ([^,]*)$/, ' or $1')

const SESSION = {
  type: 'string',
  description: 'The session by its number in the pane, its name, its folder name, or the start of its name.',
}

export const TOOL_SPECS = [
  {
    name: 'fleet_hire',
    description: 'Add a Claude session to your team and brief it for a role. Its replies are tracked on the team.',
    inputSchema: {
      type: 'object',
      properties: { session: SESSION, role: { type: 'string', enum: ROLES.map(r => r.id), description: `One of: ${ROLE_LIST}.` } },
      required: ['session', 'role'],
    },
    isDeferred: false,
  },
  {
    name: 'fleet_task',
    description:
      'Send one task to a member of your team. A member works one task at a time: a task for a busy member, or one whose after task is not done, is queued and sent when it can be. Its reply is read with fleet_status.',
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION,
        text: { type: 'string', description: 'The goal: what to do and why.' },
        scope: { type: 'string', description: 'What to touch and what to leave alone.' },
        done: { type: 'string', description: 'What done looks like: the check that proves it.' },
        after: { type: 'string', description: 'A task id on the team that must be done before this task is sent.' },
      },
      required: ['session', 'text'],
    },
    isDeferred: false,
  },
  {
    name: 'fleet_cancel',
    description: 'Cancel a member\'s open task and tell it, or take a queued task off its queue. The next queued task is then sent.',
    inputSchema: {
      type: 'object',
      properties: { session: SESSION, task: { type: 'string', description: 'The task id; the open task when left out.' } },
      required: ['session'],
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
  now: () => Promise<number>
}

const reply = (text: string, isError = false): ToolReply => ({ text, isError })

const argOf = (input: Readonly<Record<string, unknown>>, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

const optionalArg = (input: Readonly<Record<string, unknown>>, key: string): Record<string, string> => {
  const value = argOf(input, key)
  return value === '' ? {} : { [key]: value }
}

const hasTask = (roster: Readonly<Record<string, Hire>>, id: string): boolean =>
  Object.values(roster).some(h => h.task?.id === id || (h.queue ?? []).some(q => q.id === id) || (h.history ?? []).some(t => t.id === id))

// Runs one fleet tool. Bad input returns an error text and changes nothing. A throw becomes an error text that names
// the tool and the message.
export const runTool = async (name: ToolName, input: Readonly<Record<string, unknown>>, deps: ToolDeps): Promise<ToolReply> => {
  try {
    return await dispatch(name, input, deps)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return reply(`fleet-board could not run ${name}: ${why}`, true)
  }
}

const dispatch = async (name: ToolName, input: Readonly<Record<string, unknown>>, deps: ToolDeps): Promise<ToolReply> => {
  const { fleet } = deps
  if (name === 'fleet_status') {
    await fleet.refresh()
    return reply(teamStatus(await deps.roster(), await deps.now()))
  }

  const role = name === 'fleet_hire' ? argOf(input, 'role') : ''
  if (name === 'fleet_hire' && roleOf(role) === undefined) return reply(`unknown role "${role}"; use ${ROLE_LIST}`, true)
  const text = name === 'fleet_task' ? argOf(input, 'text') : ''
  if (name === 'fleet_task' && text === '') return reply('type the task first', true)
  const after = name === 'fleet_task' ? argOf(input, 'after') : ''
  if (after !== '' && !hasTask(await deps.roster(), after)) return reply(`no task ${after} on the team`, true)

  const session = argOf(input, 'session')
  if (session === '') return reply('name a session: its number, its name or its folder name', true)
  const found = resolvePeer(await fleet.refresh(), session)
  if ('error' in found) {
    const hidden = resolvePeer(fleet.outside(), session)
    return reply('peer' in hidden ? `${hidden.peer.name} is outside this project's root` : found.error, true)
  }
  const peer = found.peer

  if (name === 'fleet_hire') {
    if ((await deps.roster())[peer.id] !== undefined) return reply(`${peer.name} is already on the team; fleet_drop it first`, true)
    const out = await fleet.brief(peer, roleOf(role)!)
    return reply(out.text, !out.ok)
  }
  if (name === 'fleet_drop') {
    const out = await fleet.drop(peer)
    return reply(out.text, !out.ok)
  }
  if (name === 'fleet_cancel') {
    const task = argOf(input, 'task')
    const out = await fleet.cancel(peer, task === '' ? undefined : task)
    return reply(out.text, !out.ok)
  }
  if ((await deps.roster())[peer.id] === undefined) return reply(`${peer.name} is not on the team; hire it first with fleet_hire`, true)
  const out = await fleet.task(peer, { text, ...optionalArg(input, 'scope'), ...optionalArg(input, 'done'), ...optionalArg(input, 'after') })
  return reply(out.text, !out.ok)
}

// The answer of a tool.call hook for a fleet tool. The engine takes a tool's output as a string, an array or undefined,
// so the text is the result. An error is marked isError, with its text as the result and as the text the model reads.
export const asToolResult = (out: ToolReply): ToolCallResult =>
  out.isError ? { isError: true, result: out.text, text: out.text } : { result: out.text }
