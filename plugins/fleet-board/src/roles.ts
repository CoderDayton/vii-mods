// The roles and messages of the boss skill, so the pane and the skill brief a session the same way.

import type { RoleId } from '../types'

export type { RoleId }

export type Role = { id: RoleId; label: string; name: string; job: string }

export const ROLES: readonly Role[] = [
  {
    id: 'specialist',
    label: 'Specialist',
    name: 'Employee — Technical / Domain Specialist',
    job: 'Deep analysis, design, or specialist work in its own area.',
  },
  {
    id: 'local',
    label: 'Local execution',
    name: 'Employee — Local Execution / Support',
    job: 'Runs commands, builds, and tests; watches its local environment.',
  },
  {
    id: 'research',
    label: 'Research',
    name: 'Employee — Research / Investigation',
    job: 'Reads code, docs, and logs to answer questions and trace problems to their cause. Reports findings; does not edit.',
  },
]

export const roleOf = (id: string): Role | undefined => ROLES.find(r => r.id === id.trim().toLowerCase())

export const briefing = (boss: string, role: Role): string =>
  [
    `${boss}, the user's boss session, is adding you to the team as ${role.name}.`,
    '',
    `Job: ${role.job}`,
    '',
    'How this works:',
    '- Reply "ready" now, plus one line on what you are working on.',
    '- Keep your current work until I send you a task.',
    '- When you get a task, do it, then report: done or blocked, what changed, and how you checked it.',
    '- If anything is unclear, ask me before guessing.',
    '- If the user tells you something different in your own session, follow the user.',
  ].join('\n')

// The id is echoed in the employee's reply: the boss marks a task done only when a reply contains its id.
export const taskMessage = (boss: string, id: string, text: string): string =>
  `Task from ${boss} (id ${id}): ${text}\nPut the full report in your final reply, not in a separate message to the boss. End it with "done ${id}" or "blocked ${id}".`

export const DROP = 'You are off the team. Go back to what the user tells you.'
