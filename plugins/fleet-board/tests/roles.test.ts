import { expect, test } from 'claude-code/testing'

import { briefing, PING, ROLES, roleOf, STOP, taskMessage } from '../src/roles'

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

test('a task, a ping and a stop are plain messages from the boss', () => {
  expect(taskMessage('boss-1', 'Add tests for the parser.')).toBe('Task from boss-1: Add tests for the parser.')
  expect(PING).toBe('Status? One line: done, running or blocked, and what you are on.')
  expect(STOP).toBe('Stop your current run and wait for my next message.')
})
