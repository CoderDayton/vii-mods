import { expect, test } from 'claude-code/testing'

import { errorGist, formatFixes } from '../src/core/search/fix'
import type { Fix } from '../src/core/search/fix'
import { formatCommands } from '../src/core/search/how'

const TRACE = `Exit code 1
Traceback (most recent call last):
  File "<string>", line 2, in <module>
    from PIL import Image
ModuleNotFoundError: No module named 'PIL'
`

test('the gist of a failure is the line that names the error, not the frames above it', () => {
  expect(errorGist(TRACE)).toBe("ModuleNotFoundError: No module named 'PIL'")
  expect(errorGist('error TS2322: Type string is not assignable\n    at line 4\n\n')).toBe('error TS2322: Type string is not assignable')
  expect(errorGist('npm ERR! code ENOENT\nnpm ERR! path /x/package.json')).toBe('npm ERR! code ENOENT npm ERR! path /x/package.json')
})

test('a failure with no line that names an error gives its last lines, and a long one is cut', () => {
  expect(errorGist('first\nsecond\nthird\nfourth')).toBe('third fourth')
  expect(errorGist('')).toBe('')
  expect(errorGist(`fatal error: ${'x'.repeat(900)}`).length).toBeLessThanOrEqual(400)
})

const fix = (extra: Partial<Fix> = {}): Fix => ({
  session: '45b0ec34-1111-2222-3333-444444444444',
  project: '/home/u/work/glowseed-garden',
  ts: Date.parse('2026-09-28T10:00:00Z'),
  error: "ModuleNotFoundError: No module named 'PIL'",
  then: [
    { kind: 'cmd', text: 'pip install pillow' },
    { kind: 'assistant', text: 'Installed pillow; the script runs now.' },
  ],
  ...extra,
})

test('a fix shows the session, the error, the commands run after it and what was said', () => {
  expect(formatFixes([fix()], ['pil'], { maxChars: 2000 }).split('\n')).toEqual([
    '2026-09-28  glowseed-garden  45b0ec34',
    "  error     ModuleNotFoundError: No module named 'PIL'",
    '  then ran  pip install pillow',
    '  said      Installed pillow; the script runs now.',
  ])
})

test('no fix says so, and a long list is cut to the size asked', () => {
  expect(formatFixes([], [], { maxChars: 2000 })).toBe('No past session got past this error.')
  const text = formatFixes(Array.from({ length: 20 }, () => fix()), [], { maxChars: 500 })
  expect(text.length).toBeLessThanOrEqual(500)
  expect(text).toContain('more')
})

test('commands are listed with how often they ran, when last and where', () => {
  const text = formatCommands([
    { text: 'bun test tests/runtime', runs: 12, last: Date.parse('2026-10-11T09:00:00Z'), project: '/w/claude-mods' },
    { text: 'bun test\n  --watch', runs: 1, last: Date.parse('2026-10-02T09:00:00Z'), project: '/w/api' },
  ])
  expect(text.split('\n')).toEqual(['12×  2026-10-11  claude-mods  bun test tests/runtime', ' 1×  2026-10-02  api          bun test --watch'])
  expect(formatCommands([])).toBe('No command on record matches.')
})
