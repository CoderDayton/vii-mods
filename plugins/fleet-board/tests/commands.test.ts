import { expect, test } from 'claude-code/testing'

import { parseCommand, USAGE } from '../src/commands'

test('no word and open open the pane, and close closes it', () => {
  expect(parseCommand('')).toEqual({ kind: 'pane' })
  expect(parseCommand('  open ')).toEqual({ kind: 'pane' })
  expect(parseCommand('close')).toEqual({ kind: 'close' })
  expect(parseCommand(' Init ')).toEqual({ kind: 'init' })
})

test('the usage line names /fleet init', () => {
  expect(USAGE).toContain('/fleet init')
  expect(USAGE).not.toContain('/fleet boss')
})

test('every other word is a usage error with the usage line', () => {
  for (const args of ['list', 'ping team', 'brief 1 research', 'task 1 go', 'drop 1', 'disband', 'new /p/new', 'boss', 'wat']) {
    expect(parseCommand(args)).toEqual({ kind: 'bad', text: USAGE })
  }
})

test('the usage line names the fleet tools that replace the subcommands', () => {
  expect(USAGE.startsWith('usage: ')).toBe(true)
  for (const name of ['fleet_hire', 'fleet_task', 'fleet_cancel', 'fleet_drop', 'fleet_status']) expect(USAGE).toContain(name)
})
