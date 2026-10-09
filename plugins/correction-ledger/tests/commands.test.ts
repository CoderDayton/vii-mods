import { expect, test } from 'claude-code/testing'

import { runRules } from '../src/commands'
import type { Ledger, Rule } from '../src/rules'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

const rule = (id: number, over: Partial<Rule> = {}): Rule => ({
  id,
  text: `rule ${id}`,
  quote: `you said ${id}`,
  at: NOW - 3 * DAY,
  last: NOW - 3 * DAY,
  strikes: 0,
  ...over,
})

const ctx = (rules: Rule[] = [], enabled = true) => ({
  ledger: { next: 50, rules } as Ledger,
  enabled,
  now: NOW,
  max: 12,
})

test('an empty ledger says how a rule gets in', () => {
  const r = runRules('', ctx())
  expect(r.text).toContain('No standing corrections')
  expect(r.ledger).toBeUndefined()
})

test('the list shows each rule with its number, its breaks and what the user said', () => {
  const r = runRules('', ctx([rule(1), rule(3, { strikes: 2, text: '2nd cat: no ProximityPrompt.' })]))
  expect(r.text).toContain('Standing corrections for this project (2)')
  expect(r.text).toContain('#1  rule 1')
  expect(r.text).toContain('#3  [broken 2×] 2nd cat: no ProximityPrompt.')
  expect(r.text).toContain('you said 1')
  expect(r.text).toContain('3d ago')
})

test('a rule broken three times is told it needs more than a reminder', () => {
  const r = runRules('list', ctx([rule(1, { strikes: 3 })]))
  expect(r.text).toContain('broken 3 times')
  expect(r.text).toContain('CLAUDE.md')
})

test('rm removes one rule and says which', () => {
  const r = runRules('rm 3', ctx([rule(1), rule(3)]))
  expect(r.ledger?.rules.map(x => x.id)).toEqual([1])
  expect(r.text).toBe('Removed #3: rule 3')
})

test('rm of a rule that is not there changes nothing', () => {
  const r = runRules('rm 9', ctx([rule(1)]))
  expect(r.text).toBe('No rule #9.')
  expect(r.ledger).toBeUndefined()
})

test('rm without a number says how to use it', () => {
  expect(runRules('rm', ctx([rule(1)])).text).toContain('Usage: /rules rm <number>')
  expect(runRules('rm x', ctx([rule(1)])).text).toContain('Usage: /rules rm <number>')
})

test('clear empties the ledger and counts what went', () => {
  const r = runRules('clear', ctx([rule(1), rule(2)]))
  expect(r.ledger?.rules).toEqual([])
  expect(r.text).toBe('Cleared 2 rules.')
})

test('add saves a rule by hand', () => {
  const r = runRules('add never use var', ctx())
  expect(r.ledger?.rules).toMatchObject([{ id: 50, text: 'never use var', quote: 'added by hand', strikes: 0 }])
  expect(r.text).toBe('Saved #50: never use var')
})

test('add without text, or with an echo of an existing rule, saves nothing', () => {
  expect(runRules('add', ctx()).text).toContain('Usage: /rules add <rule>')
  const r = runRules('add RULE 1!', ctx([rule(1)]))
  expect(r.ledger).toBeUndefined()
  expect(r.text).toContain('Already saved as #1')
})

test('off and on pause and resume the ledger', () => {
  expect(runRules('off', ctx())).toMatchObject({ enabled: false })
  expect(runRules('on', ctx([], false))).toMatchObject({ enabled: true })
  expect(runRules('', ctx([rule(1)], false)).text).toContain('paused')
})

test('anything else prints the usage', () => {
  expect(runRules('dance', ctx()).text).toContain('Usage: /rules')
})
