import { expect, test } from 'claude-code/testing'

import { bossLabel, bossSection, employeeSection, hireKey, parseEmployment, parseTeam, teamKey } from '../src/team'

test('the store keeps the team under the boss and each hire under the employee', () => {
  expect(teamKey('me')).toBe('team:me')
  expect(hireKey('q1')).toBe('hire:q1')
})

test('a stored team keeps only well-formed members', () => {
  const stored = {
    q1: { name: 'quorum-63', role: 'research', briefedAt: 5 },
    bad: { name: 'x', role: 'boss', briefedAt: 5 },
    junk: 'nope',
  }
  expect(parseTeam(stored)).toEqual({ q1: { name: 'quorum-63', dir: '', role: 'research', briefedAt: 5 } })
  expect(parseTeam(undefined)).toEqual({})
  expect(parseTeam([])).toEqual({})
})

test('a stored member keeps its folder and the time its reply was seen, when it has one', () => {
  const stored = { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 5, readyAt: 9 } }
  expect(parseTeam(stored)).toEqual({ q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 5, readyAt: 9 } })
  expect(parseTeam({ q1: { name: 'x', dir: '/p', role: 'research', briefedAt: 5, readyAt: 'soon' } })).toEqual({})
})

test('a stored hire keeps its boss and role, and anything else is no hire', () => {
  expect(parseEmployment({ bossId: 'me', bossName: 'claude-mods-1c', role: 'local' })).toEqual({
    bossId: 'me',
    bossName: 'claude-mods-1c',
    role: 'local',
  })
  expect(parseEmployment({ bossId: 'me', bossName: 'x', role: 'boss' })).toBeNull()
  expect(parseEmployment({ bossName: 'x', role: 'local' })).toBeNull()
  expect(parseEmployment(null)).toBeNull()
})

test('the boss label names the session by its name and its id', () => {
  expect(bossLabel('claude-mods-1c', 'me')).toBe('claude-mods-1c (session me)')
})

test('a boss with no team gets no boss section', () => {
  expect(bossSection({})).toBeNull()
})

test('the boss section says it is the boss and lists each employee with its role and id', () => {
  const text = bossSection({
    q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 5 },
    m1: { name: 'mnemos-9e', dir: '/p/mnemos', role: 'local', briefedAt: 6 },
  })
  expect(text).toContain('You are the boss')
  expect(text).toContain('- quorum-63 (session q1): Research')
  expect(text).toContain('- mnemos-9e (session m1): Local execution')
  expect(text).toContain('/fleet disband')
})

test('the boss section says which employees have replied and which are still waiting', () => {
  const text = bossSection({
    q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 5, readyAt: 9 },
    m1: { name: 'mnemos-9e', dir: '/p/mnemos', role: 'local', briefedAt: 6 },
  })
  expect(text).toContain('- quorum-63 (session q1): Research, ready')
  expect(text).toContain('- mnemos-9e (session m1): Local execution, waiting for a reply')
})

test('the employee section names its boss and role and says where reports go', () => {
  const text = employeeSection({ bossId: 'me', bossName: 'claude-mods-1c', role: 'research' })
  expect(text).toContain('claude-mods-1c (session me)')
  expect(text).toContain('Research')
  expect(text).toContain('Send your reports to session me')
})
