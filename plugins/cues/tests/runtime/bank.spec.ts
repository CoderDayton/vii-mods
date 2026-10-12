import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TARGET_LOUDNESS, TARGET_PEAK, loudnessOf } from '../../src/audio/level'
import { encodeWav } from '../../src/audio/wav'
import { loadBank } from '../../src/daemon/bank'

const RATE = 48_000
const SOUNDS = join(import.meta.dir, '../../sounds')

const folder = (files: Record<string, Uint8Array>) => {
  const dir = mkdtempSync(join(tmpdir(), 'cues-bank-'))
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), bytes)
  }
  return dir
}

test('a wav file is a clip named by its path, at the player rate', () => {
  const dir = folder({ 'keys/x/press/r1.wav': encodeWav(Int16Array.from([1, 2, 3, 4]), RATE / 2) })
  const clip = loadBank(dir, RATE).get('keys/x/press/r1')
  expect(clip?.length).toBe(8)
})

test('a chime is built in, and a wav of its name takes its place', () => {
  const builtIn = loadBank(folder({}), RATE)
  expect([...builtIn.keys()].sort()).toEqual(['chimes/bell', 'chimes/error', 'chimes/notes', 'chimes/send'])
  const mine = loadBank(folder({ 'chimes/send.wav': encodeWav(Int16Array.from([7, -7]), RATE) }), RATE)
  expect(Array.from(mine.get('chimes/send') ?? [])).toEqual([TARGET_PEAK, -TARGET_PEAK])
})

test('a file that is not wav is left out', () => {
  const bank = loadBank(folder({ 'keys/x/press/r1.wav': new Uint8Array(100), 'keys/LICENSE': new Uint8Array(4) }), RATE)
  expect(bank.has('keys/x/press/r1')).toBe(false)
})

test('every key press and chime that ships is as loud as the next, and no clip is louder', () => {
  for (const [name, samples] of loadBank(SOUNDS, RATE)) {
    const loudness = loudnessOf(samples, RATE)
    expect(loudness).toBeLessThanOrEqual(TARGET_LOUDNESS + 1)
    if (!name.includes('/release/')) expect(loudness).toBeGreaterThan(TARGET_LOUDNESS * 0.95)
  }
})

test('every switch that ships has the clips each key falls back to', () => {
  const bank = loadBank(SOUNDS, RATE)
  const switches = new Set([...bank.keys()].filter(k => k.startsWith('keys/')).map(k => k.split('/')[1]))
  expect(switches.size).toBe(13)
  for (const name of switches) {
    for (const clip of ['press/r0', 'press/r1', 'press/r2', 'press/r3', 'press/r4', 'release/key']) {
      expect(bank.get(`keys/${name}/${clip}`)?.length ?? 0).toBeGreaterThan(0)
    }
  }
})
