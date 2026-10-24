import type { AskOptions } from 'claude-code'

import type { Fleet } from './fleet'
import { resolvePeer } from './peers'
import type { Peer } from './peers'
import { roleOf, ROLES } from './roles'
import type { Role } from './roles'
import { liveBoss, runTool } from './tools'
import type { ToolDeps } from './tools'

export type Ask = (question: string, options: AskOptions) => Promise<string>

const SHOWN = 4

const NO_ONE = 'No other session in this project is free to hire. Start claude in another terminal here, then run /fleet init again.'

const freeSessions = async (deps: ToolDeps, self: string): Promise<Peer[]> => {
  const roster = await deps.roster()
  const peers = await deps.fleet.refresh()
  const running = [...peers, ...deps.fleet.outside()]
  const free: Peer[] = []
  for (const peer of peers) {
    if (roster[peer.id] !== undefined) continue
    const job = await liveBoss(deps, peer.id, running)
    if (job === null || job.bossId === self) free.push(peer)
  }
  return free
}

const pick = async (free: readonly Peer[], ask: Ask): Promise<{ picked: Peer[]; errors: string[] }> => {
  const only = free.length === 1 ? free[0] : undefined
  if (only !== undefined) {
    const answer = await ask(`Hire ${only.name}?`, { options: ['Hire it', 'Not now'], header: 'Hire' })
    return { picked: answer === 'Hire it' ? [only] : [], errors: [] }
  }
  const hidden = free.length - SHOWN
  const question = hidden > 0 ? `Which sessions should join your team (type any of the ${hidden} not listed under Other)?` : 'Which sessions should join your team?'
  const answer = await ask(question, { options: free.slice(0, SHOWN).map(p => p.name), header: 'Hire', multiSelect: true })
  const picked: Peer[] = []
  const errors: string[] = []
  for (const name of answer.split(',').map(s => s.trim()).filter(s => s !== '')) {
    const exact = free.find(p => p.name === name)
    const found = exact === undefined ? resolvePeer(free, name) : { peer: exact }
    if ('error' in found) errors.push(found.error)
    else if (!picked.includes(found.peer)) picked.push(found.peer)
  }
  return { picked, errors }
}

const roleFor = async (peer: Peer, ask: Ask): Promise<Role | string> => {
  const answer = (await ask(`What role should ${peer.name} have?`, { options: ROLES.map(r => r.label), header: 'Role' })).trim()
  return ROLES.find(r => r.label.toLowerCase() === answer.toLowerCase()) ?? roleOf(answer) ?? `${peer.name} was not hired: no role "${answer}"`
}

export const paneAction = async (f: Fleet, deps: ToolDeps, peer: Peer | undefined, key: string): Promise<void> => {
  if (peer === undefined) return
  const [kind, roleId] = key.split(':')
  const role = roleOf(roleId ?? '')
  if (kind === 'role' && role !== undefined) {
    await f.setRole(peer, role)
    return
  }
  const out =
    kind === 'hire' && role !== undefined
      ? await runTool('fleet_hire', { session: peer.id, role: role.id }, deps)
      : kind === 'fire'
        ? await runTool('fleet_drop', { session: peer.id }, deps)
        : null
  if (out?.isError === true) await f.note(false, out.text)
}

export const runBoss = async (deps: ToolDeps, ask: Ask, kickoff: (text: string) => Promise<void>): Promise<string> => {
  const self = await deps.selfId()
  const mine = await liveBoss(deps, self)
  if (mine !== null) return `You are on ${mine.bossName}'s team, so you cannot be a boss. Ask ${mine.bossName} to hire the sessions you want.`
  const free = await freeSessions(deps, self)
  if (free.length === 0) return NO_ONE
  const lines: string[] = []
  const hired: string[] = []
  try {
    const { picked, errors } = await pick(free, ask)
    lines.push(...errors)
    for (const peer of picked) {
      const role = await roleFor(peer, ask)
      if (typeof role === 'string') {
        lines.push(role)
        continue
      }
      const out = await runTool('fleet_hire', { session: peer.id, role: role.id }, deps)
      if (!out.isError) hired.push(`${peer.name} (${role.label})`)
      lines.push(out.text)
    }
  } catch {
    if (lines.length === 0) return 'Cancelled. Nothing changed.'
    lines.push('Stopped; the rest were not hired.')
  }
  if (hired.length === 0) return [...lines, 'Nobody was hired.'].join('\n')
  await kickoff(
    `Your team is hired: ${hired.join(', ')}. Ask the user what the team should work on first, with AskUserQuestion. Then post that goal with fleet_post, and split it into tasks with fleet_task.`,
  )
  return [...lines, 'Next, this session asks you what the team should work on.'].join('\n')
}
