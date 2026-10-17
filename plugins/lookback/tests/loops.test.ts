import { expect, test } from 'claude-code/testing'

import { cutLoop } from '../src/core/text/loops'

test('a word or phrase said over and over is cut after its first time, and the text before it stays', () => {
  expect(cutLoop(`Settings page Port: 8080 ${'0 '.repeat(200)}`)).toBe('Settings page Port: 8080 0')
  expect(cutLoop(`Players ${'vii '.repeat(90)}`)).toBe('Players vii')
  expect(cutLoop(`Stats ${'PS:795 '.repeat(60)}PS:`)).toBe('Stats PS:795')
  expect(cutLoop(`Menu\n${'VR Hands\n'.repeat(40)}`)).toBe('Menu\nVR Hands')
  expect(cutLoop(`Docs\n${'- "How to use"\n'.repeat(30)}`)).toBe('Docs\n- "How to use"')
  expect(cutLoop(`Games ${'[ST] '.repeat(50)}`)).toBe('Games [ST]')
})

test('text that repeats a little, as real screens do, is kept whole', () => {
  const chat = 'DiM 8:00 PM yep figured\nDiM 8:08 PM its still off by a few degrees\nDiM 8:09 PM test test test'
  expect(cutLoop(chat)).toBe(chat)
  const list = '- Hood Customs 71% Rating\n- KNIFE DUELS 93% Rating\n- Twenty One 93% Rating'
  expect(cutLoop(list)).toBe(list)
  expect(cutLoop('')).toBe('')
})
