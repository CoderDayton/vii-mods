import { expect, test } from 'claude-code/testing'

import { addRule, emptyLedger, findSimilar, parseLedger, removeRule, replaceRule, strikeRule } from '../src/rules'
import type { Ledger, Rule } from '../src/rules'

const rule = (id: number, over: Partial<Rule> = {}): Rule => ({
  id,
  text: `rule ${id}`,
  quote: `said ${id}`,
  at: 1000,
  last: 1000,
  strikes: 0,
  ...over,
})

const ledgerOf = (rules: Rule[], next = 100): Ledger => ({ next, rules })

test('a new rule takes the next id, with no strikes', () => {
  const l = addRule(emptyLedger(), { text: 'Keep the names.', quote: 'i said keep the names', now: 5000 }, 12)
  expect(l.rules).toEqual([{ id: 1, text: 'Keep the names.', quote: 'i said keep the names', at: 5000, last: 5000, strikes: 0 }])
  expect(l.next).toBe(2)
})

test('ids are never reused after a rule is removed', () => {
  let l = addRule(emptyLedger(), { text: 'a', quote: 'a', now: 1 }, 12)
  l = removeRule(l, 1).ledger
  l = addRule(l, { text: 'b', quote: 'b', now: 2 }, 12)
  expect(l.rules.map(r => r.id)).toEqual([2])
})

test('past the cap the rule with the fewest strikes, then the oldest use, goes', () => {
  const full = ledgerOf([rule(1, { last: 10 }), rule(2, { strikes: 2, last: 5 }), rule(3, { last: 20 })], 4)
  const l = addRule(full, { text: 'new', quote: 'q', now: 30 }, 3)
  expect(l.rules.map(r => r.id)).toEqual([2, 3, 4])
})

test('a strike counts one more break and refreshes the rule', () => {
  const l = strikeRule(ledgerOf([rule(1), rule(2)]), 2, 9000)
  expect(l.rules[1]).toMatchObject({ id: 2, strikes: 1, last: 9000 })
  expect(l.rules[0]).toMatchObject({ id: 1, strikes: 0, last: 1000 })
  expect(strikeRule(l, 2, 9500).rules[1]?.strikes).toBe(2)
})

test('a strike on a rule that is not there changes nothing', () => {
  const l = ledgerOf([rule(1)])
  expect(strikeRule(l, 7, 5)).toEqual(l)
})

test('a replaced rule keeps its id and its strikes', () => {
  const l = replaceRule(ledgerOf([rule(1, { strikes: 2 })]), 1, { text: 'new text', quote: 'new quote', now: 7000 })
  expect(l.rules).toEqual([{ id: 1, text: 'new text', quote: 'new quote', at: 1000, last: 7000, strikes: 2 }])
})

test('removing a rule says which one went', () => {
  const r = removeRule(ledgerOf([rule(1), rule(2)]), 2)
  expect(r.removed?.id).toBe(2)
  expect(r.ledger.rules.map(x => x.id)).toEqual([1])
  expect(removeRule(r.ledger, 9).removed).toBe(null)
})

test('a rule says the same thing when only case, punctuation and contractions differ', () => {
  const l = ledgerOf([rule(1, { text: 'Do not edit in Blender unless asked.' }), rule(2, { text: '2nd cat: no ProximityPrompt. It loops its path.' })])
  expect(findSimilar(l, "don't edit in blender unless asked")?.id).toBe(1)
  expect(findSimilar(l, 'DO NOT EDIT IN BLENDER UNLESS ASKED!!')?.id).toBe(1)
  expect(findSimilar(l, 'Use click, not ProximityPrompt, for the monitor and the hatch.')).toBe(null)
  expect(findSimilar(l, '')).toBe(null)
})

test('stored data is checked: bad rules are dropped and the next id stays ahead', () => {
  const raw = {
    next: 2,
    rules: [rule(5), { id: 'x' }, null, { ...rule(6), strikes: -4 }, { ...rule(7), text: '' }, { ...rule(8), text: 'y'.repeat(900) }],
  }
  const l = parseLedger(raw)
  expect(l.rules.map(r => r.id)).toEqual([5, 6, 8])
  expect(l.rules[1]?.strikes).toBe(0)
  expect(l.rules[2]?.text.length).toBeLessThanOrEqual(200)
  expect(l.next).toBe(9)
})

test('anything that is not a ledger reads as an empty one', () => {
  for (const raw of [undefined, null, 'x', 4, [], { rules: 'no' }]) expect(parseLedger(raw)).toEqual(emptyLedger())
})
