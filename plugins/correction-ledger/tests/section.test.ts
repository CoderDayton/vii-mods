import { expect, test } from 'claude-code/testing'

import type { Rule } from '../src/rules'
import { MAX_SECTION_CHARS, blockNote, remindNote, ruleSection } from '../src/section'

const WHEN = { tool: 'Bash', words: ['git', 'commit'] }

const rule = (id: number, text: string, over: Partial<Rule> = {}): Rule => ({
  id,
  text,
  quote: '',
  at: 0,
  last: id,
  strikes: 0,
  life: 'project',
  seen: 0,
  ...over,
})

test('no rules, no section', () => {
  expect(ruleSection([])).toBe(null)
})

test('rules are listed under a header that tells Claude to follow them without being reminded', () => {
  const text = ruleSection([rule(1, 'Imports keep the same asset name.')]) ?? ''
  expect(text).toContain('Standing corrections from this user for this project.')
  expect(text).toContain('- Imports keep the same asset name.')
  expect(text).not.toContain('broken')
})

test('a rule that was broken is marked, listed first, and the header says to check against it', () => {
  const text =
    ruleSection([
      rule(1, 'Imports keep the same asset name.', { last: 50 }),
      rule(3, '2nd cat: no ProximityPrompt. It loops its path.', { strikes: 3, last: 10 }),
      rule(2, 'Sun crystal goes in a different seed location.', { strikes: 1, last: 20 }),
    ]) ?? ''
  const lines = text.split('\n').filter(l => l.startsWith('- '))
  expect(lines).toEqual([
    '- [broken 3×] 2nd cat: no ProximityPrompt. It loops its path.',
    '- [broken 1×] Sun crystal goes in a different seed location.',
    '- Imports keep the same asset name.',
  ])
  expect(text).toContain('were ignored before')
  expect(text).toContain('Check your work against each one before you answer.')
})

test('a rule that fires on a call is not sent every turn', () => {
  const text = ruleSection([rule(1, 'Imports keep the same asset name.'), rule(2, 'Never commit without asking.', { when: WHEN })]) ?? ''
  expect(text).toContain('- Imports keep the same asset name.')
  expect(text).not.toContain('commit')
  expect(ruleSection([rule(2, 'Never commit without asking.', { when: WHEN })])).toBe(null)
})

test('the reminder and the block name the rules and say what to do next', () => {
  const rules = [rule(2, 'Never commit without asking.', { when: WHEN, strikes: 2 })]
  expect(remindNote(rules)).toContain('- [broken 2×] Never commit without asking.')
  expect(remindNote(rules)).toContain('covers the call you just made')
  expect(blockNote(rules)).toContain('- [broken 2×] Never commit without asking.')
  expect(blockNote(rules)).toContain('make the same call again')
})

test('unbroken rules are listed newest use first', () => {
  const lines = (ruleSection([rule(1, 'old', { last: 1 }), rule(2, 'new', { last: 9 })]) ?? '').split('\n').filter(l => l.startsWith('- '))
  expect(lines).toEqual(['- new', '- old'])
})

test('the section stays under its size cap, dropping the lowest-ranked rules first', () => {
  const many = Array.from({ length: 40 }, (_, i) => rule(i + 1, `rule number ${i + 1} ${'x'.repeat(190)}`, { strikes: i === 39 ? 5 : 0, last: i }))
  const text = ruleSection(many) ?? ''
  expect(text.length).toBeLessThanOrEqual(MAX_SECTION_CHARS)
  expect(text).toContain('rule number 40')
})
