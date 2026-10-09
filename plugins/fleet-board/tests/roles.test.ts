import { expect, test } from 'claude-code/testing'

import { briefing, DROP, ROLES, roleOf, taskMessage } from '../src/roles'

test('there are three roles, each with a short id, a label and a job', () => {
  expect(ROLES.map(r => r.id)).toEqual(['specialist', 'local', 'research'])
  for (const r of ROLES) {
    expect(r.label.length).toBeGreaterThan(0)
    expect(r.job.endsWith('.')).toBe(true)
  }
})

test('a role is found by id, case ignored, and an unknown one is undefined', () => {
  expect(roleOf('Research')?.id).toBe('research')
  expect(roleOf('boss')).toBeUndefined()
})

test('the briefing names the boss, the role and its job, and asks for "ready"', () => {
  const text = briefing('claude-mods-1c', roleOf('research')!)
  expect(text.startsWith("claude-mods-1c, the user's boss session, is adding you to the team as Employee — Research / Investigation.")).toBe(true)
  expect(text).toContain('Job: Reads code, docs, and logs')
  expect(text).toContain('Reply "ready" now, plus one line on what you are working on.')
  expect(text).toContain('Keep your current work until I send you a task.')
  expect(text).toContain('done or blocked, what changed, and how you checked it')
  expect(text).toContain("If the user tells you something different in your own session, follow the user.")
})

test('a task is a plain message from the boss, and a drop tells the member it is off the team', () => {
  expect(taskMessage('boss-1', 'k3x9qa', 'Add tests for the parser.')).toBe(
    'Task from boss-1 (id k3x9qa): Add tests for the parser.\nPut the full report in your final reply, not in a separate message to the boss. End it with "done k3x9qa" or "blocked k3x9qa".',
  )
  expect(DROP).toBe('You are off the team. Go back to what the user tells you.')
})
