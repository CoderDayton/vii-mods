import { expect, test } from 'claude-code/testing'

import { acceptEnhanced, buildRequest, refusalReason } from '../src/enhance'

const wrap = (s: string): string => `<enhanced>${s}</enhanced>`

const LONG_DRAFT = 'make a calculator in python and make it good and fast'

test('refusalReason names the guard that refused the reply', () => {
  expect(refusalReason(LONG_DRAFT, 'Sure, here you go')).toMatch(/no <enhanced> text/)
  expect(refusalReason(LONG_DRAFT, wrap(''))).toMatch(/no <enhanced> text/)
  expect(refusalReason(LONG_DRAFT, wrap('x'.repeat(LONG_DRAFT.length * 6)))).toMatch(/too long/)
  expect(refusalReason(LONG_DRAFT, wrap('Totally unrelated words about gardening and weather today'))).toMatch(/few words/)
  expect(refusalReason('look at `foo()` and make a calculator in python', wrap('look at it and make a calculator in python'))).toMatch(
    /dropped/,
  )
})

const MESSY =
  'so um the login page is broke when i click submit nothing happens, can u look into it and fix it and also check the logout cuz i think its the same bug, dont change the styling tho'

test('a restructured rewrite that keeps under half of the draft words is accepted', () => {
  const rewrite =
    "Investigate and fix the login page and logout functionality.\n\n**Problem:** The submit button on the login page is not responding when clicked. I think the logout may have the same bug.\n\n**Constraint:** Do not change the styling."
  expect(acceptEnhanced(MESSY, wrap(rewrite))).toBe(rewrite)
})

test('an answer to the draft instead of a rewrite is still refused', () => {
  const draft = 'why does the build fail on ci but pass locally is it the node version'
  const answer = 'Most likely your CI image ships an older Node, so pin it in .nvmrc.'
  expect(acceptEnhanced(draft, wrap(answer))).toBeNull()
  expect(refusalReason(draft, wrap(answer))).toMatch(/few words/)
})

test('refusalReason is null for a reply that is accepted', () => {
  expect(refusalReason(LONG_DRAFT, wrap('Make a fast, good Python calculator.'))).toBeNull()
})

test('the request wraps the draft as data and asks for the <enhanced> tags', () => {
  const r = buildRequest('make a calculator')
  expect(r.prompt).toBe('<draft>\nmake a calculator\n</draft>')
  expect(r.system).toContain('<enhanced>')
  expect(r.system).toContain('<draft>')
})

test('the instructions edit every sentence, turn polite requests into instructions and keep real questions', () => {
  const s = buildRequest('x').system
  expect(s).toContain('Edit every sentence')
  expect(s).toContain('"can you X?"')
  expect(s).toContain('State each fact once')
  expect(s).toContain('Turn a real question')
  expect(s).not.toContain('questions stay questions')
  expect(s).not.toContain('Alter period or question marks')
})

test('a reply much longer than the draft is refused, a modest one is kept', () => {
  const draft = 'make a calculator in python and make it good and fast'
  expect(acceptEnhanced(draft, wrap('x'.repeat(draft.length * 4)))).toBeNull()
  expect(acceptEnhanced(draft, wrap('Make a fast, good Python calculator.'))).toBe('Make a fast, good Python calculator.')
})

test('punctuation stuck to a mention, a path or a URL does not count as part of it', () => {
  const draft = 'check @src/app.ts, then ./lib/mod.rs. See (https://a.dev/x) and `npm test`.'
  const rewrite = 'Check @src/app.ts and ./lib/mod.rs; see https://a.dev/x and run `npm test`'
  expect(acceptEnhanced(draft, wrap(rewrite))).toBe(rewrite)
  expect(acceptEnhanced(draft, wrap(rewrite.replace('@src/app.ts', 'the app')))).toBeNull()
})

test('a reply that shares few words with the draft is an answer, not a rewrite, and is refused', () => {
  const draft = 'what does this function do when the cache is empty'
  expect(acceptEnhanced(draft, wrap('It returns null and logs a warning.'))).toBeNull()
})

test('a real rewrite keeps most of the draft words and is accepted', () => {
  const draft = 'hey can u check why the build hangs on step 3 its been like this since friday'
  const rewrite = 'Can you check why the build hangs on step 3? It has been like this since Friday.'
  expect(acceptEnhanced(draft, wrap(rewrite))).toBe(rewrite)
})

test('a very short draft skips the word check', () => {
  expect(acceptEnhanced('fix it', wrap('Fix the failing test.'))).toBe('Fix the failing test.')
})

test('a tagged reply is used, trimmed', () => {
  expect(acceptEnhanced('make a calculator', `Sure!\n${wrap('\n  Write a Python calculator.\n')}`)).toBe(
    'Write a Python calculator.',
  )
})

test('a reply with no tags, or an empty one, is refused', () => {
  expect(acceptEnhanced('make a calculator', 'Write a Python calculator.')).toBeNull()
  expect(acceptEnhanced('make a calculator', wrap('   '))).toBeNull()
})

test('a reply that grows far beyond the draft is refused', () => {
  expect(acceptEnhanced('fix it', wrap('x'.repeat(2000)))).toBeNull()
})

test('an image tag, an @file mention, a code span, a URL or a path must survive', () => {
  const draft = 'look at [Image #1] and @src/app.ts with `npm test` at https://a.dev/x in ./lib/mod.rs'
  const kept = 'Please review [Image #1] and @src/app.ts, running `npm test`, see https://a.dev/x and ./lib/mod.rs.'
  expect(acceptEnhanced(draft, wrap(kept))).toBe(kept)
  for (const lost of ['[Image #1]', '@src/app.ts', '`npm test`', 'https://a.dev/x', './lib/mod.rs']) {
    expect(acceptEnhanced(draft, wrap(kept.replace(lost, 'it')))).toBeNull()
  }
})
