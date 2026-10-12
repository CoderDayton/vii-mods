import { expect, test } from 'claude-code/testing'

import { Mixer } from '../src/audio/mixer'
import { Pump } from '../src/audio/pump'
import { resample } from '../src/audio/resample'
import { playerArgv, route } from '../src/daemon/route'

const RATE = 1000
const TIMING = { leadMs: 10, prerollMs: 20, holdMs: 100 }
const COLD = (TIMING.prerollMs + TIMING.leadMs) * 2

const clip = (frames: number) => new Int16Array(frames).fill(100)

test('an idle pump writes nothing', () => {
  const pump = new Pump(new Mixer(), RATE, TIMING)
  expect(pump.due(0)).toBeNull()
  expect(pump.due(500)).toBeNull()
})

test('a cold pump writes silence ahead of the first clip, then keeps pace with the clock', () => {
  const mixer = new Mixer()
  const pump = new Pump(mixer, RATE, TIMING)
  mixer.add(clip(40), 1)
  const first = Array.from(pump.due(1000) ?? [])
  expect(first.length).toBe(COLD)
  expect(first.slice(0, TIMING.prerollMs * 2).every(v => v === 0)).toBe(true)
  expect(first[TIMING.prerollMs * 2]).toBe(100)
  expect(pump.due(1000)).toBeNull()
  expect(pump.due(1005)?.length).toBe(5 * 2)
})

test('a pump keeps the stream fed with silence for a while after its clips end', () => {
  const mixer = new Mixer()
  const pump = new Pump(mixer, RATE, TIMING)
  mixer.add(clip(8), 1)
  pump.due(0)
  const quiet = Array.from(pump.due(50) ?? [])
  expect(quiet.length).toBe(50 * 2)
  expect(quiet.every(v => v === 0)).toBe(true)
  expect(pump.isIdle).toBe(false)
})

test('a clip that starts while the stream is fed needs no silence ahead of it', () => {
  const mixer = new Mixer()
  const pump = new Pump(mixer, RATE, TIMING)
  mixer.add(clip(8), 1)
  pump.due(0)
  pump.due(50)
  mixer.add(clip(8), 1)
  expect(Array.from(pump.due(60) ?? []).slice(0, 2)).toEqual([100, 100])
})

test('a pump left quiet past its hold goes idle, and the next clip starts it cold', () => {
  const mixer = new Mixer()
  const pump = new Pump(mixer, RATE, TIMING)
  mixer.add(clip(8), 1)
  pump.due(0)
  pump.due(100)
  pump.due(200)
  expect(pump.isIdle).toBe(true)
  expect(pump.due(300)).toBeNull()
  mixer.add(clip(8), 1)
  expect(pump.due(9000)?.length).toBe(COLD)
})

test('a pump that was held up does not write the time it missed', () => {
  const mixer = new Mixer()
  const pump = new Pump(mixer, RATE, TIMING)
  mixer.add(clip(5000), 1)
  pump.due(0)
  expect(pump.due(900)?.length).toBe(TIMING.leadMs * 2)
})

test('resampling keeps a clip its length in time', () => {
  expect(resample(Int16Array.from([0, 100, 200, 300]), 4, 4).length).toBe(4)
  expect(Array.from(resample(Int16Array.from([0, 100, 200, 300]), 4, 8))).toEqual([0, 50, 100, 150, 200, 250, 300, 300])
  expect(Array.from(resample(Int16Array.from([0, 100, 200, 300]), 4, 2))).toEqual([0, 200])
})

test('a play request plays the first clip the bank has', () => {
  const played: { clip: string; gain: number }[] = []
  const bank = new Map([['keys/topre/press/r4', clip(1)]])
  const play = (samples: Int16Array, gain: number) => played.push({ clip: [...bank].find(([, s]) => s === samples)?.[0] ?? '', gain })
  expect(route('/play?clips=keys/topre/press/space,keys/topre/press/r4&gain=0.5', bank, play)).toBe(204)
  expect(played).toEqual([{ clip: 'keys/topre/press/r4', gain: 0.5 }])
})

test('a request for no known clip, or for anything else, plays nothing', () => {
  const played: number[] = []
  const play = () => played.push(1)
  expect(route('/play?clips=keys/none/press/r1', new Map(), play)).toBe(404)
  expect(route('/play?clips=../x', new Map(), play)).toBe(400)
  expect(route('/ping', new Map(), play)).toBe(204)
  expect(route('/other', new Map(), play)).toBe(400)
  expect(played).toEqual([])
})

test('the player is pw-cat when there is one, then aplay, then none', () => {
  const has = (...names: string[]) => (name: string) => (names.includes(name) ? `/usr/bin/${name}` : null)
  expect(playerArgv(has('pw-cat', 'aplay'), 48_000)?.[0]).toBe('/usr/bin/pw-cat')
  expect(playerArgv(has('pw-cat'), 48_000)).toContain('48000')
  expect(playerArgv(has('aplay'), 48_000)?.[0]).toBe('/usr/bin/aplay')
  expect(playerArgv(has(), 48_000)).toBeNull()
})

test('the pw-cat stream is its own, so a volume saved for music is not put on it', () => {
  const argv = playerArgv(name => (name === 'pw-cat' ? '/usr/bin/pw-cat' : null), 48_000) ?? []
  expect(argv[argv.indexOf('--media-role') + 1]).toBe('Notification')
  expect(argv[argv.indexOf('--volume') + 1]).toBe('1')
  const properties = argv[argv.indexOf('--properties') + 1] ?? ''
  expect(properties).toContain('application.name = "cues"')
  expect(properties).toContain('state.restore-props = false')
  expect(argv[argv.length - 1]).toBe('-')
})
