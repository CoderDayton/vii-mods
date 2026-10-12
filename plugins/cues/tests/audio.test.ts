import { expect, test } from 'claude-code/testing'

import { TARGET_LOUDNESS, TARGET_PEAK, levelBank, loudnessOf } from '../src/audio/level'
import { Mixer } from '../src/audio/mixer'
import { SYNTH_SOUNDS, synthChime } from '../src/audio/synth'
import { decodeWav, encodeWav } from '../src/audio/wav'

const RATE = 48_000

test('a wav file written and read back gives the same samples', () => {
  const samples = Int16Array.from([0, 100, -100, 32767, -32768])
  const wav = decodeWav(encodeWav(samples, RATE))
  expect(wav.rate).toBe(RATE)
  expect(wav.channels).toBe(1)
  expect(Array.from(wav.samples)).toEqual(Array.from(samples))
})

test('a stereo wav is folded to one channel', () => {
  const stereo = encodeWav(Int16Array.from([100, 300, -50, -150]), RATE, 2)
  expect(Array.from(decodeWav(stereo).samples)).toEqual([200, -100])
})

test('bytes that are not 16-bit PCM wav are refused', () => {
  expect(() => decodeWav(new Uint8Array(64))).toThrow()
})

test('an idle mixer renders silence', () => {
  const m = new Mixer()
  expect(m.isIdle).toBe(true)
  expect(Array.from(m.render(2))).toEqual([0, 0, 0, 0])
})

test('a voice plays on both channels at its gain, then the mixer is idle', () => {
  const m = new Mixer()
  m.add(Int16Array.from([1000, -1000, 500]), 0.5)
  expect(Array.from(m.render(2))).toEqual([500, 500, -500, -500])
  expect(m.isIdle).toBe(false)
  expect(Array.from(m.render(2))).toEqual([250, 250, 0, 0])
  expect(m.isIdle).toBe(true)
})

test('voices that overlap are summed, and a sum past 16 bits is eased under the limit', () => {
  const m = new Mixer()
  m.add(Int16Array.from([100, 30000, -30000, 14000]), 1)
  m.add(Int16Array.from([50, 30000, -30000, 14000]), 1)
  const [quiet, , loud, , low, , near] = Array.from(m.render(4))
  expect(quiet).toBe(150)
  expect(loud).toBeGreaterThan(31_000)
  expect(loud).toBeLessThan(32_768)
  expect(low).toBe(-(loud ?? 0))
  // A sum just over the knee is turned down a little, not cut flat.
  expect(near).toBeGreaterThan(26_500)
  expect(near).toBeLessThan(28_000)
})

const peakOf = (samples: Int16Array | undefined) => (samples ?? new Int16Array()).reduce((max, v) => Math.max(max, Math.abs(v)), 0)

// At this rate the 100 ms the ear sums over is 10 samples.
const SLOW = 100

test('loudness is the level of the loudest tenth of a second, so a shorter sound counts for less', () => {
  expect(Math.round(loudnessOf(new Int16Array(30).fill(1000), SLOW))).toBe(1000)
  expect(Math.round(loudnessOf(Int16Array.from([0, 0, 0, ...new Array<number>(10).fill(-1000), 0, 0]), SLOW))).toBe(1000)
  expect(Math.round(loudnessOf(new Int16Array(5).fill(1000), SLOW))).toBe(707)
})

test('every clip comes out equally loud, a quiet key, a loud key and a chime alike', () => {
  const bank = levelBank(
    new Map([
      ['keys/soft/press/r1', new Int16Array(20).fill(100)],
      ['keys/loud/press/r1', new Int16Array(20).fill(20_000)],
      ['chimes/send', new Int16Array(40).fill(-6000)],
    ]),
    SLOW,
  )
  for (const samples of bank.values()) expect(Math.abs(loudnessOf(samples, SLOW) - TARGET_LOUDNESS) <= 1).toBe(true)
})

test('a clip too sharp to reach the loudness is brought up only until its peak is at the limit', () => {
  const spike = new Int16Array(2000)
  spike[7] = -100
  const bank = levelBank(new Map([['keys/sharp/press/r1', spike]]), 10_000)
  expect(peakOf(bank.get('keys/sharp/press/r1'))).toBe(TARGET_PEAK)
})

test('a silent clip is left as it is', () => {
  const bank = levelBank(new Map([['chimes/send', new Int16Array(4)]]), SLOW)
  expect(Array.from(bank.get('chimes/send') ?? [])).toEqual([0, 0, 0, 0])
})

test('a voice past the limit takes the place of the oldest one', () => {
  const m = new Mixer(2)
  m.add(Int16Array.from([1, 1]), 1)
  m.add(Int16Array.from([10, 10]), 1)
  m.add(Int16Array.from([100, 100]), 1)
  expect(Array.from(m.render(1))).toEqual([110, 110])
})

test('each chime is short, audible, and starts and ends at rest', () => {
  expect([...SYNTH_SOUNDS].sort()).toEqual(['bell', 'error', 'notes', 'send'])
  for (const name of SYNTH_SOUNDS) {
    const cue = synthChime(name, RATE)
    const peak = cue.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
    expect(cue.length).toBeGreaterThan(RATE * 0.05)
    expect(cue.length).toBeLessThan(RATE * 0.6)
    expect(peak).toBeGreaterThan(4000)
    expect(peak).toBeLessThan(24_000)
    expect(Math.abs(cue[0] ?? 0)).toBeLessThan(200)
    expect(Math.abs(cue[cue.length - 1] ?? 0)).toBeLessThan(200)
  }
})
