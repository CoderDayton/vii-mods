import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MIN_BUN, runtimeInfo, runtimeProblem } from '../../src/runtime/runtime'

const root = join(import.meta.dir, '../..')

test('the oldest Bun the code accepts is the one package.json asks for, and nothing pins an exact one', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: { bun: string }; packageManager?: string }
  expect(pkg.engines.bun).toBe(`>=${MIN_BUN}`)
  expect(pkg.packageManager).toBeUndefined()
  expect(existsSync(join(root, '.bun-version'))).toBe(false)
})

test('the runtime reports the Bun, SQLite and vector extension versions it runs on', () => {
  const info = runtimeInfo()
  expect(info.bun).toBe(Bun.version)
  expect(info.sqlite).toMatch(/^3\.\d+\.\d+/)
  expect(info.vector).toMatch(/^\d+\.\d+\.\d+/)
})

test('the oldest Bun and any newer one are fine', () => {
  for (const version of [MIN_BUN, '1.4.3', '1.10.0', '2.0.0', '1.5.0-canary.12']) expect(runtimeProblem(version)).toBeNull()
})

test('an older Bun is a problem that names both versions', () => {
  for (const version of ['1.3.9', '1.3.12', '0.9.0']) {
    expect(runtimeProblem(version)).toContain(MIN_BUN)
    expect(runtimeProblem(version)).toContain(version)
  }
})

test('a version that cannot be read is a problem, not a pass', () => {
  expect(runtimeProblem('')).not.toBeNull()
  expect(runtimeProblem('latest')).not.toBeNull()
})
