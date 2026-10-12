import { expect, test } from 'claude-code/testing'

import { parsePlay, playUrl } from '../src/request'

test('a play request round-trips its clips and gain', () => {
  const url = playUrl(['keys/topre/press/space', 'keys/topre/press/r4'], 0.456)
  expect(url).toBe('http://cues/play?clips=keys/topre/press/space,keys/topre/press/r4&gain=0.46')
  expect(parsePlay(url.slice('http://cues'.length))).toEqual({ clips: ['keys/topre/press/space', 'keys/topre/press/r4'], gain: 0.46 })
})

test('gain is held between 0 and 2, and is 1 when not given', () => {
  expect(parsePlay('/play?clips=chimes/send&gain=9')?.gain).toBe(2)
  expect(parsePlay('/play?clips=chimes/send&gain=-1')?.gain).toBe(0)
  expect(parsePlay('/play?clips=chimes/send')?.gain).toBe(1)
})

test('anything but a play request with clean clip names is refused', () => {
  expect(parsePlay('/ping')).toBeNull()
  expect(parsePlay('/play')).toBeNull()
  expect(parsePlay('/play?clips=')).toBeNull()
  expect(parsePlay('/play?clips=../../etc/passwd')).toBeNull()
  expect(parsePlay('/play?clips=/abs/path')).toBeNull()
  expect(parsePlay('/play?clips=chimes/send&gain=loud')).toBeNull()
})
