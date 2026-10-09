import { expect, test } from 'claude-code/testing'

import {
  DIR_ARGV,
  isPaused,
  ledgerPathOf,
  pauseArgv,
  readLedger,
  swapArgv,
  updateLedger,
} from '../src/disk'
import type { Disk } from '../src/disk'
import { addRule, emptyLedger } from '../src/rules'
import type { Ledger } from '../src/rules'

const DIR = '/cfg/plugins/correction-ledger'
const NOW = 1_000

const draft = (text: string) => ({ text, quote: '', now: NOW })

// A disk whose swap script behaves as the real one: replace only if the file still holds OLD.
const fakeDisk = (files = new Map<string, string>(), beforeSwap: () => void = () => undefined) => {
  const swaps: string[] = []
  const disk: Disk = {
    dir: DIR,
    read: async path => files.get(path) ?? null,
    exists: async path => files.has(path),
    run: async (argv, init) => {
      if (argv[3] !== 'correction-ledger-swap') return { exitCode: 1, stdout: '' }
      const path = argv[4] ?? ''
      beforeSwap()
      swaps.push(path)
      if ((files.get(path) ?? '') !== (init?.env?.['OLD'] ?? '')) return { exitCode: 4, stdout: '' }
      files.set(path, init?.stdin ?? '')
      return { exitCode: 0, stdout: '' }
    },
  }
  return { disk, files, swaps }
}

const rulesIn = (files: Map<string, string>, cwd: string): string[] => {
  const text = files.get(ledgerPathOf(DIR, cwd))
  return text === undefined ? [] : (JSON.parse(text) as Ledger).rules.map(r => r.text)
}

test('one folder has one ledger file, inside the mod directory, whatever the path holds', () => {
  const a = ledgerPathOf(DIR, '/work/app')
  expect(ledgerPathOf(DIR, '/work/app')).toBe(a)
  expect(ledgerPathOf(DIR, '/work/other')).not.toBe(a)
  expect(ledgerPathOf(DIR, '/a/app')).not.toBe(ledgerPathOf(DIR, '/b/app'))
  const odd = ledgerPathOf(DIR, '/work/../x y/$(rm -rf)/"q"\n')
  expect(odd.startsWith(`${DIR}/`)).toBe(true)
  expect(odd.slice(DIR.length + 1)).toMatch(/^[a-z0-9._-]+$/)
})

test('a missing, corrupt or foreign file reads as an empty ledger', async () => {
  const { disk, files } = fakeDisk()
  expect(await readLedger(disk, '/work')).toEqual(emptyLedger())
  files.set(ledgerPathOf(DIR, '/work'), '{not json')
  expect(await readLedger(disk, '/work')).toEqual(emptyLedger())
  files.set(ledgerPathOf(DIR, '/work'), '[1,2]')
  expect(await readLedger(disk, '/work')).toEqual(emptyLedger())
})

test('an update reads the file, applies the change and swaps the new ledger in', async () => {
  const { disk, files } = fakeDisk()
  const out = await updateLedger(disk, '/work', l => ({ ledger: addRule(l, draft('never use var'), 12), result: 'saved' }))
  expect(out).toBe('saved')
  expect(rulesIn(files, '/work')).toEqual(['never use var'])
})

test('a change that leaves the ledger alone writes nothing', async () => {
  const { disk, swaps } = fakeDisk()
  const out = await updateLedger(disk, '/work', l => ({ ledger: l, result: 'nothing' }))
  expect(out).toBe('nothing')
  expect(swaps).toEqual([])
})

test('when another session writes first, the update runs again on what it wrote', async () => {
  const files = new Map<string, string>()
  let rival = true
  const { disk } = fakeDisk(files, () => {
    if (!rival) return
    rival = false
    files.set(ledgerPathOf(DIR, '/work'), JSON.stringify(addRule(emptyLedger(), draft('rule from the other session'), 12)))
  })
  await updateLedger(disk, '/work', l => ({ ledger: addRule(l, draft('rule from this session'), 12), result: null }))
  expect(rulesIn(files, '/work')).toEqual(['rule from the other session', 'rule from this session'])
  const ids = (JSON.parse(files.get(ledgerPathOf(DIR, '/work')) ?? '') as Ledger).rules.map(r => r.id)
  expect(ids).toEqual([1, 2])
})

test('the change sees the fresh ledger each time it runs', async () => {
  const files = new Map<string, string>()
  let rival = true
  const { disk } = fakeDisk(files, () => {
    if (!rival) return
    rival = false
    files.set(ledgerPathOf(DIR, '/work'), JSON.stringify(addRule(emptyLedger(), draft('first'), 12)))
  })
  const seen: number[] = []
  await updateLedger(disk, '/work', l => {
    seen.push(l.rules.length)
    return { ledger: addRule(l, draft('second'), 12), result: null }
  })
  expect(seen).toEqual([0, 1])
})

test('an update that never wins gives up with an error', async () => {
  const files = new Map<string, string>()
  let n = 0
  const { disk } = fakeDisk(files, () => {
    n += 1
    files.set(ledgerPathOf(DIR, '/work'), JSON.stringify(addRule(emptyLedger(), draft(`rival ${n}`), 12)))
  })
  await expect(updateLedger(disk, '/work', l => ({ ledger: addRule(l, draft('mine'), 12), result: null }))).rejects.toThrow()
})

test('a swap that fails for another reason is an error, not a retry', async () => {
  const { disk, swaps } = fakeDisk()
  disk.run = async () => ({ exitCode: 3, stdout: '' })
  await expect(updateLedger(disk, '/work', l => ({ ledger: addRule(l, draft('x'), 12), result: null }))).rejects.toThrow()
  expect(swaps).toEqual([])
})

test('the swap script locks, compares with OLD and renames into place', () => {
  const argv = swapArgv('/cfg/x/ledger.json')
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv[3]).toBe('correction-ledger-swap')
  expect(argv[4]).toBe('/cfg/x/ledger.json')
  const script = argv[2] ?? ''
  expect(script).toContain('flock')
  expect(script).toContain('$OLD')
  expect(script).toContain('mv ')
  expect(script).toContain('exit 4')
})

test('the directory script prints the mod directory under the Claude config directory', () => {
  expect(DIR_ARGV[3]).toBe('correction-ledger-dir')
  expect(DIR_ARGV[2]).toContain('CLAUDE_CONFIG_DIR')
  expect(DIR_ARGV[2]).toContain('plugins/correction-ledger')
})

test('pausing is a flag file: on creates it, off removes it, and the disk reports it', async () => {
  const on = pauseArgv(DIR, true)
  const off = pauseArgv(DIR, false)
  expect(on[3]).toBe('correction-ledger-pause')
  expect(off[3]).toBe('correction-ledger-pause')
  expect(on[2]).not.toBe(off[2])
  const { disk, files } = fakeDisk()
  expect(await isPaused(disk)).toBe(false)
  files.set(`${DIR}/paused`, '')
  expect(await isPaused(disk)).toBe(true)
})
