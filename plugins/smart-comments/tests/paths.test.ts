import { expect, test } from 'claude-code/testing'

import { absolute, isInstalled } from '../src/paths'

test('files of an installed skill or plugin are someone else’s', () => {
  expect(isInstalled('/home/u/.claude/skills/x/run.ts', '/home/u')).toBe(true)
  expect(isInstalled('/home/u/.claude/plugins/cache/p/hooks/a.ts', '/home/u')).toBe(true)
  expect(isInstalled('/home/u/.agents/skills/x/a.py', '/home/u')).toBe(true)
})

test('other files are not, and a folder that only starts the same is not', () => {
  expect(isInstalled('/home/u/code/app/a.ts', '/home/u')).toBe(false)
  expect(isInstalled('/home/u/.claude/skills-mine/a.ts', '/home/u')).toBe(false)
  expect(isInstalled('/home/u/.claude/skills/a.ts', '')).toBe(false)
})

test('a relative path is taken from the working folder', () => {
  expect(absolute('src/a.ts', '/work')).toBe('/work/src/a.ts')
  expect(absolute('/etc/a.toml', '/work')).toBe('/etc/a.toml')
})

test('two spellings of one file give one path', () => {
  expect(absolute('./src/a.ts', '/work')).toBe('/work/src/a.ts')
  expect(absolute('src/../a.ts', '/work')).toBe('/work/a.ts')
  expect(absolute('/work//src/./a.ts', '/tmp')).toBe('/work/src/a.ts')
  expect(absolute('../../../a.ts', '/work')).toBe('/a.ts')
})
