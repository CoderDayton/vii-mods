// The boss's team and each employee's place on it. Both are kept in the plugin's store, so they survive a
// restart, and the prompt of each session says what it is: the boss its employees, an employee its boss.

import { roleOf } from './roles'
import type { Employment, Hire } from '../types'

export type { Employment, Hire }

export const teamKey = (bossId: string): string => `team:${bossId}`

export const hireKey = (employeeId: string): string => `hire:${employeeId}`

export const bossLabel = (name: string, id: string): string => `${name} (session ${id})`

const roleLabel = (id: string): string => roleOf(id)?.label ?? id

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const parseHire = (v: unknown): Hire | null => {
  if (!isObject(v)) return null
  const { name, dir, role, briefedAt, readyAt } = v
  if (typeof name !== 'string' || typeof role !== 'string' || typeof briefedAt !== 'number') return null
  if (dir !== undefined && typeof dir !== 'string') return null
  if (readyAt !== undefined && typeof readyAt !== 'number') return null
  const known = roleOf(role)
  if (known === undefined) return null
  const hire: Hire = { name, dir: dir ?? '', role: known.id, briefedAt }
  return readyAt === undefined ? hire : { ...hire, readyAt }
}

export const parseTeam = (v: unknown): Record<string, Hire> => {
  if (!isObject(v)) return {}
  const team: Record<string, Hire> = {}
  for (const [id, raw] of Object.entries(v)) {
    const hire = parseHire(raw)
    if (hire !== null) team[id] = hire
  }
  return team
}

export const parseEmployment = (v: unknown): Employment | null => {
  if (!isObject(v)) return null
  const { bossId, bossName, role } = v
  if (typeof bossId !== 'string' || typeof bossName !== 'string' || typeof role !== 'string') return null
  const known = roleOf(role)
  return known === undefined ? null : { bossId, bossName, role: known.id }
}

// Null when the session has no team, so a session that is not a boss gets no boss text.
export const bossSection = (team: Readonly<Record<string, Hire>>): string | null => {
  const members = Object.entries(team)
  if (members.length === 0) return null
  return [
    'You are the boss of a team of Claude sessions. Each session below is your employee.',
    '',
    'Your team:',
    ...members.map(([id, hire]) => `- ${hire.name} (session ${id}): ${roleLabel(hire.role)}, ${hire.readyAt === undefined ? 'waiting for a reply' : 'ready'}`),
    '',
    'Hand out work by message: one task per message, with the goal, the area and what done looks like.',
    'Check a "done" yourself before you pass it on. /fleet list shows the team, /fleet drop <session> removes a member,',
    'and /fleet disband ends the team when the user says stop.',
  ].join('\n')
}

export const employeeSection = (e: Employment): string =>
  [
    `You are an employee. ${bossLabel(e.bossName, e.bossId)} is your boss, and you are on its team as ${roleLabel(e.role)}.`,
    `Take tasks from your boss only. Send your reports to session ${e.bossId}.`,
    'If the user tells you something different in your own session, follow the user.',
  ].join('\n')
