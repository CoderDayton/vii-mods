import { expect, test } from 'claude-code/testing'

import { runCommand } from '../src/command'
import { DEFAULTS, gainFor, restore } from '../src/settings'

test('the volume setting follows the ear: half the setting is a quarter of the level', () => {
  expect(gainFor(1)).toBe(1)
  expect(gainFor(0.5)).toBe(0.25)
  expect(gainFor(0)).toBe(0)
})

test('saved settings are restored, and anything unusable falls back to the default', () => {
  expect(restore(undefined)).toEqual(DEFAULTS)
  expect(restore({ switch: 'topre', volume: 0.3, keys: false })).toEqual({ ...DEFAULTS, switch: 'topre', volume: 0.3, chimeVolume: 0.3, keys: false })
  expect(restore({ switch: 'nope', volume: 9, isOn: 'yes' })).toEqual(DEFAULTS)
})

test('no words shows the state and lists the switches', () => {
  const out = runCommand('', DEFAULTS)
  expect(out.settings).toBeUndefined()
  expect(out.text).toContain('keys volume 70 · chimes volume 70')
  expect(out.text).toContain('topre')
  expect(out.text).toContain('/cues')
})

test('off and on mute and unmute everything', () => {
  const off = runCommand('off', DEFAULTS)
  expect(off.settings?.isOn).toBe(false)
  expect(runCommand('on', off.settings ?? DEFAULTS).settings?.isOn).toBe(true)
  expect(runCommand('mute', DEFAULTS).settings?.isOn).toBe(false)
  expect(runCommand('unmute', { ...DEFAULTS, isOn: false }).settings?.isOn).toBe(true)
})

test('the state says when the player is not running', () => {
  expect(runCommand('', DEFAULTS, false).text).toContain('no sound: the player is not running')
  expect(runCommand('', DEFAULTS, true).text).not.toContain('no sound')
})

test('volume with no number says what both volumes are', () => {
  const out = runCommand('volume', { ...DEFAULTS, volume: 0.35, chimeVolume: 0.6 })
  expect(out.settings).toBeUndefined()
  expect(out.text).toBe('Keys volume is 35, chimes volume is 60. /cues volume keys|chimes 0-100 sets one, /cues volume 0-100 sets both.')
})

test('keys and chimes each have a volume of their own', () => {
  const keys = runCommand('volume keys 30', DEFAULTS)
  expect(keys.settings).toEqual({ ...DEFAULTS, volume: 0.3 })
  expect(keys.text).toBe('Keys volume 30.')
  const chimes = runCommand('volume chimes 250', DEFAULTS)
  expect(chimes.settings).toEqual({ ...DEFAULTS, chimeVolume: 1 })
  expect(chimes.text).toBe('Chimes volume 100.')
  expect(runCommand('volume keys', { ...DEFAULTS, volume: 0.3 }).text).toBe('Keys volume is 30. /cues volume keys 0-100 sets it.')
  expect(runCommand('volume chimes loud', DEFAULTS).settings).toBeUndefined()
  expect(runCommand('', { ...DEFAULTS, volume: 0.3 }).text).toContain('keys volume 30 · chimes volume 70')
})

test('settings saved with one volume use it for the chimes too', () => {
  expect(restore({ volume: 0.5 }).chimeVolume).toBe(0.5)
  expect(restore({ volume: 0.5, chimeVolume: 0.9 }).chimeVolume).toBe(0.9)
  expect(restore({ volume: 0.5, chimeVolume: 7 }).chimeVolume).toBe(0.5)
})

test('volume takes 0 to 100 and clamps what is over', () => {
  expect(runCommand('volume 40', DEFAULTS).settings).toEqual({ ...DEFAULTS, volume: 0.4, chimeVolume: 0.4 })
  expect(runCommand('volume 40', DEFAULTS).text).toBe('Volume 40.')
  expect(runCommand('volume 250', DEFAULTS).settings?.volume).toBe(1)
  expect(runCommand('volume loud', DEFAULTS).settings).toBeUndefined()
})

test('a switch name picks that switch and turns key sounds on', () => {
  const out = runCommand('HolyPanda', { ...DEFAULTS, keys: false, isOn: false })
  expect(out.settings?.switch).toBe('holypanda')
  expect(out.settings?.keys).toBe(true)
  expect(out.settings?.isOn).toBe(true)
  expect(out.text).toContain('Holy Panda')
})

test('each group of sounds turns off and on by its name', () => {
  expect(runCommand('keys off', DEFAULTS).settings?.keys).toBe(false)
  expect(DEFAULTS.claude).toBe(false)
  expect(runCommand('claude on', DEFAULTS).settings?.claude).toBe(true)
  expect(runCommand('claude off', { ...DEFAULTS, claude: true }).settings?.claude).toBe(false)
})

test('each chime turns off and on alone', () => {
  expect(runCommand('send off', DEFAULTS).settings).toEqual({ ...DEFAULTS, send: false })
  expect(runCommand('reply off', DEFAULTS).settings).toEqual({ ...DEFAULTS, reply: false })
  expect(runCommand('error off', DEFAULTS).settings).toEqual({ ...DEFAULTS, error: false })
  expect(runCommand('reply on', { ...DEFAULTS, reply: false }).settings).toEqual(DEFAULTS)
  expect(runCommand('reply off', DEFAULTS).text).toBe('Reply chime off.')
})

test('the reply chime has two sounds to pick from, and picking one turns it on', () => {
  expect(DEFAULTS.replySound).toBe('bell')
  const out = runCommand('reply notes', { ...DEFAULTS, reply: false })
  expect(out.settings).toEqual({ ...DEFAULTS, replySound: 'notes' })
  expect(out.text).toBe('Reply chime is now the two low notes.')
  expect(runCommand('reply bell', { ...DEFAULTS, replySound: 'notes' }).settings).toEqual(DEFAULTS)
  expect(runCommand('', DEFAULTS).text).toContain('reply sound: bell')
  expect(restore({ replySound: 'gong' }).replySound).toBe('bell')
})

test("Claude's keys can have a switch of their own, or follow the user's", () => {
  expect(DEFAULTS.claudeSwitch).toBeNull()
  const out = runCommand('claude Topre', { ...DEFAULTS, isOn: false })
  expect(out.settings).toEqual({ ...DEFAULTS, claude: true, claudeSwitch: 'topre' })
  expect(out.text).toBe("Claude's keys now sound like Topre.")
  const same = runCommand('claude same', { ...DEFAULTS, claudeSwitch: 'topre' })
  expect(same.settings).toEqual(DEFAULTS)
  expect(same.text).toBe("Claude's keys now sound like yours.")
  expect(runCommand('', DEFAULTS).text).toContain("claude's switch: same as yours")
  expect(runCommand('', { ...DEFAULTS, claudeSwitch: 'topre' }).text).toContain("claude's switch: topre")
  expect(restore({ claudeSwitch: 'topre' }).claudeSwitch).toBe('topre')
  expect(restore({ claudeSwitch: 'nope' }).claudeSwitch).toBeNull()
})

test('chimes turns all three off or on at once', () => {
  const off = runCommand('chimes off', DEFAULTS)
  expect(off.settings).toEqual({ ...DEFAULTS, send: false, reply: false, error: false })
  expect(runCommand('chimes on', { ...DEFAULTS, send: false, error: false }).settings).toEqual(DEFAULTS)
  expect(off.text).toBe('Chimes off.')
})

test('the state shows each sound on or off', () => {
  const text = runCommand('', { ...DEFAULTS, reply: false }).text
  expect(text).toContain('keys on · claude off · send on · reply off · error on')
})

test('words it does not know change nothing and say what it takes', () => {
  const out = runCommand('louder please', DEFAULTS)
  expect(out.settings).toBeUndefined()
  expect(out.text).toContain('/cues volume')
  expect(out.text).toContain('holypanda')
})
