import { expect, test } from 'claude-code/testing'

import { applyVerdict } from '../src/apply'
import { emptyLedger } from '../src/rules'
import type { Ledger, Rule } from '../src/rules'

const rule = (id: number, over: Partial<Rule> = {}): Rule => ({
  id,
  text: `rule ${id}`,
  quote: '',
  at: 1,
  last: 1,
  strikes: 0,
  life: 'project',
  seen: 0,
  ...over,
})

const ledgerOf = (rules: Rule[]): Ledger => ({ next: 20, rules, days: 0, day: 0 })
const WHEN = { quote: 'i said keep the names', now: 9000, max: 12 }

test('a new rule is saved with what the user said, and the note says how to undo it', () => {
  const r = applyVerdict(emptyLedger(), { kind: 'new', text: 'Imports keep the same asset name.', life: 'project' }, WHEN)
  expect(r.ledger.rules).toMatchObject([
    { id: 1, text: 'Imports keep the same asset name.', quote: 'i said keep the names', strikes: 0, life: 'project' },
  ])
  expect(r.note).toBe('correction-ledger: saved rule #1: Imports keep the same asset name. (/rules rm 1 to undo)')
})

test('a task rule is saved as one, and the note says how to keep it', () => {
  const r = applyVerdict(emptyLedger(), { kind: 'new', text: 'Stop the run after the first epoch.', life: 'task' }, WHEN)
  expect(r.ledger.rules).toMatchObject([{ id: 1, life: 'task' }])
  expect(r.note).toBe(
    'correction-ledger: saved rule #1 for this task: Stop the run after the first epoch. (/rules rm 1 to undo, /rules keep 1 to keep)',
  )
})

test('a rule with a trigger is saved with it, and the note says what it fires on', () => {
  const when = { tool: 'Bash', words: ['git', 'commit'] }
  const r = applyVerdict(emptyLedger(), { kind: 'new', text: 'Never commit without asking.', life: 'project', when }, WHEN)
  expect(r.ledger.rules[0]?.when).toEqual(when)
  expect(r.note).toBe('correction-ledger: saved rule #1: Never commit without asking. [fires on Bash: git commit] (/rules rm 1 to undo)')
})

test('a repeat is a strike on the rule, and the note counts the breaks', () => {
  const r = applyVerdict(ledgerOf([rule(3, { strikes: 1 })]), { kind: 'repeat', id: 3 }, WHEN)
  expect(r.ledger.rules[0]).toMatchObject({ strikes: 2, last: 9000 })
  expect(r.note).toBe('correction-ledger: rule #3 broken again (2×): rule 3')
})

test('a new rule that says what a saved one says is a strike, not a copy', () => {
  const l = ledgerOf([rule(4, { text: 'Do not edit in Blender unless asked.' })])
  const r = applyVerdict(l, { kind: 'new', text: "don't edit in blender unless asked", life: 'task' }, WHEN)
  expect(r.ledger.rules.length).toBe(1)
  expect(r.ledger.rules[0]?.strikes).toBe(1)
  expect(r.note).toContain('rule #4 broken again (1×)')
})

test('a replace rewrites the rule and keeps its breaks', () => {
  const r = applyVerdict(ledgerOf([rule(1, { strikes: 2 })]), { kind: 'replace', id: 1, text: 'Imports may be renamed now.', life: 'task' }, WHEN)
  expect(r.ledger.rules[0]).toMatchObject({ id: 1, text: 'Imports may be renamed now.', strikes: 2, quote: 'i said keep the names' })
  expect(r.note).toBe('correction-ledger: updated rule #1: Imports may be renamed now.')
})

test('no verdict, no change and no note', () => {
  const l = ledgerOf([rule(1)])
  const r = applyVerdict(l, { kind: 'none', reason: 'not a correction' }, WHEN)
  expect(r.ledger).toBe(l)
  expect(r.note).toBe(null)
})

test('a repeat or replace of a rule that has gone changes nothing', () => {
  const l = ledgerOf([rule(1)])
  expect(applyVerdict(l, { kind: 'repeat', id: 9 }, WHEN)).toEqual({ ledger: l, note: null })
  expect(applyVerdict(l, { kind: 'replace', id: 9, text: 'a rule that is long enough', life: 'task' }, WHEN).note).toContain('saved rule')
})
