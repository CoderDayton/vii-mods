import { expect, test } from 'claude-code/testing'

import { addRule, daysLeft, emptyLedger, findSimilar, keepRule, parseLedger, removeRule, replaceRule, strikeRule, tick, touchRule } from '../src/rules'
import type { Ledger, Rule } from '../src/rules'

const DAY = 86_400_000
const LIVES = { task: 2, project: 14 }

const rule = (id: number, over: Partial<Rule> = {}): Rule => ({
  id,
  text: `rule ${id}`,
  quote: `said ${id}`,
  at: 1000,
  last: 1000,
  strikes: 0,
  life: 'project',
  seen: 0,
  ...over,
})

const ledgerOf = (rules: Rule[], next = 100, days = 0): Ledger => ({ next, rules, days, day: days })

test('a new rule takes the next id, with no strikes', () => {
  const l = addRule(emptyLedger(), { text: 'Keep the names.', quote: 'i said keep the names', now: 5000, life: 'task' }, 12)
  expect(l.rules).toEqual([
    { id: 1, text: 'Keep the names.', quote: 'i said keep the names', at: 5000, last: 5000, strikes: 0, life: 'task', seen: 0 },
  ])
  expect(l.next).toBe(2)
})

const WHEN = { tool: 'Bash', words: ['git', 'commit'] }

test('a rule may carry the call it fires on, and a replaced rule takes the trigger of the new text or none', () => {
  const l = addRule(emptyLedger(), { text: 'Ask before a commit.', quote: 'q', now: 1, life: 'project', when: WHEN }, 12)
  expect(l.rules[0]?.when).toEqual(WHEN)
  const pushed = { tool: 'Bash', words: ['git', 'push'] }
  expect(replaceRule(l, 1, { text: 'Ask before a push.', quote: 'q', now: 2, life: 'project', when: pushed }).rules[0]?.when).toEqual(pushed)
  expect(replaceRule(l, 1, { text: 'Ask first.', quote: 'q', now: 2, life: 'project' }).rules[0]?.when).toBeUndefined()
})

test('a rule that fired counts as seen today', () => {
  const l = ledgerOf([rule(1, { seen: 2 }), rule(2, { seen: 2 })], 9, 6)
  expect(touchRule(l, 1).rules.map(r => r.seen)).toEqual([6, 2])
  const fresh = ledgerOf([rule(1, { seen: 6 })], 9, 6)
  expect(touchRule(fresh, 1)).toBe(fresh)
})

test('a stored trigger is kept when it is whole and dropped when it is not', () => {
  const l = parseLedger({ next: 3, rules: [{ ...rule(1), when: WHEN }, { ...rule(2), when: { tool: 'Bash', words: ['a b'] } }] })
  expect(l.rules[0]?.when).toEqual(WHEN)
  expect(l.rules[1]).toMatchObject({ id: 2 })
  expect(l.rules[1]?.when).toBeUndefined()
})

test('ids are never reused after a rule is removed', () => {
  let l = addRule(emptyLedger(), { text: 'a', quote: 'a', now: 1, life: 'project' }, 12)
  l = removeRule(l, 1).ledger
  l = addRule(l, { text: 'b', quote: 'b', now: 2, life: 'project' }, 12)
  expect(l.rules.map(r => r.id)).toEqual([2])
})

test('past the cap the rule with the fewest strikes, then the oldest use, goes', () => {
  const full = ledgerOf([rule(1, { last: 10 }), rule(2, { strikes: 2, last: 5 }), rule(3, { last: 20 })], 4)
  const l = addRule(full, { text: 'new', quote: 'q', now: 30, life: 'project' }, 3)
  expect(l.rules.map(r => r.id)).toEqual([2, 3, 4])
})

test('past the cap a kept rule goes last', () => {
  const full = ledgerOf([rule(1, { last: 10, life: 'kept' }), rule(2, { strikes: 2, last: 5 }), rule(3, { last: 20 })], 4)
  const l = addRule(full, { text: 'new', quote: 'q', now: 30, life: 'project' }, 3)
  expect(l.rules.map(r => r.id)).toEqual([1, 2, 4])
})

test('a rule saved on a new day counts that day as worked', () => {
  const l = addRule(ledgerOf([], 1, 3), { text: 'new', quote: 'q', now: 9 * DAY, life: 'task' }, 12)
  expect(l).toMatchObject({ days: 4, day: 9 })
  expect(l.rules[0]?.seen).toBe(4)
  expect(daysLeft(l, l.rules[0] as Rule, LIVES)).toBe(2)
})

test('a task rule lasts two worked days and a project rule fourteen', () => {
  const l = ledgerOf([rule(1, { life: 'task', seen: 4 }), rule(2, { seen: 4 }), rule(3, { life: 'kept', seen: 0 })], 9, 5)
  expect(l.rules.map(r => daysLeft(l, r, LIVES))).toEqual([1, 13, Infinity])
})

test('each break buys the rule its life again', () => {
  const l = ledgerOf([rule(1, { life: 'task', seen: 2, strikes: 1 })], 9, 5)
  expect(daysLeft(l, l.rules[0] as Rule, LIVES)).toBe(1)
})

test('a day the project is worked on counts once, and days away do not count', () => {
  const l = ledgerOf([rule(1, { life: 'task', seen: 5 })], 9, 5)
  const same = tick(l, 5 * DAY + 99, LIVES)
  expect(same.ledger).toBe(l)
  const later = tick(l, 40 * DAY, LIVES)
  expect(later.ledger).toMatchObject({ days: 6, day: 40 })
  expect(later.expired).toEqual([])
})

test('a rule that ran out goes on the next worked day, and the tick says which', () => {
  const l = ledgerOf([rule(1, { life: 'task', seen: 4 }), rule(2, { seen: 4 }), rule(3, { life: 'kept' })], 9, 5)
  const t = tick(l, 6 * DAY, LIVES)
  expect(t.expired.map(r => r.id)).toEqual([1])
  expect(t.ledger.rules.map(r => r.id)).toEqual([2, 3])
})

test('keeping a rule stops it from running out', () => {
  const l = keepRule(ledgerOf([rule(1, { life: 'task' })], 9, 50), 1)
  expect(l.rules[0]?.life).toBe('kept')
  expect(tick(l, 99 * DAY, LIVES).expired).toEqual([])
})

test('a strike counts one more break and refreshes the rule', () => {
  const l = strikeRule(ledgerOf([rule(1), rule(2)]), 2, 9000)
  expect(l.rules[1]).toMatchObject({ id: 2, strikes: 1, last: 9000 })
  expect(strikeRule(ledgerOf([rule(1, { seen: 1 })], 9, 7), 1, 7 * DAY).rules[0]?.seen).toBe(7)
  expect(l.rules[0]).toMatchObject({ id: 1, strikes: 0, last: 1000 })
  expect(strikeRule(l, 2, 9500).rules[1]?.strikes).toBe(2)
})

test('a strike on a rule that is not there changes nothing', () => {
  const l = ledgerOf([rule(1)])
  expect(strikeRule(l, 7, 5)).toEqual(l)
})

test('a replaced rule keeps its id and its strikes', () => {
  const l = replaceRule(ledgerOf([rule(1, { strikes: 2, life: 'task' })]), 1, { text: 'new text', quote: 'new quote', now: 7000, life: 'project' })
  expect(l.rules).toEqual([{ id: 1, text: 'new text', quote: 'new quote', at: 1000, last: 7000, strikes: 2, life: 'task', seen: 0 }])
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

test('a ledger saved before rules had a life reads as project rules on day zero', () => {
  const l = parseLedger({ next: 2, rules: [{ id: 1, text: 'old rule', quote: '', at: 1, last: 1, strikes: 0 }] })
  expect(l).toMatchObject({ days: 0, day: 0 })
  expect(l.rules[0]).toMatchObject({ life: 'project', seen: 0 })
})

test('a stored rule cannot be seen later than the ledger has days', () => {
  const l = parseLedger({ next: 2, days: 3, day: 9, rules: [{ ...rule(1), seen: 99, life: 'task' }] })
  expect(l.rules[0]).toMatchObject({ life: 'task', seen: 3 })
})

test('anything that is not a ledger reads as an empty one', () => {
  for (const raw of [undefined, null, 'x', 4, [], { rules: 'no' }]) expect(parseLedger(raw)).toEqual(emptyLedger())
})
