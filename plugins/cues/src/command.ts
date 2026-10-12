import { REPLY_SOUNDS, SWITCHES, isReplySound, isSwitch } from './settings'
import type { Settings, Switch } from './settings'

// What `/cues <args>` answers, and the settings to save when it changed them.
export type CommandResult = { text: string; settings?: Settings }

// Each sound that turns on and off alone, by the word that names it in the command.
const SOUNDS = {
  keys: 'Your key sounds',
  claude: "Claude's key sounds",
  send: 'Send chime',
  reply: 'Reply chime',
  error: 'Error chime',
} as const
type Sound = keyof typeof SOUNDS

const USAGE = [
  '/cues on | off   (or unmute | mute)',
  '/cues volume 0-100   (keys and chimes at once)',
  '/cues volume keys | chimes  0-100',
  '/cues <switch>',
  '/cues claude <switch> | same   (a switch for what Claude writes)',
  '/cues keys | claude | send | reply | error  on | off',
  '/cues chimes on | off   (send, reply and error at once)',
  '/cues reply bell | notes',
].join('\n')

const isSound = (word: string): word is Sound => Object.hasOwn(SOUNDS, word)
const onOff = (isOn: boolean) => (isOn ? 'on' : 'off')
const percent = (volume: number) => Math.round(volume * 100)

// The two volumes, by the word that names each in the command.
const VOLUMES = { keys: { field: 'volume', label: 'Keys' }, chimes: { field: 'chimeVolume', label: 'Chimes' } } as const
const isVolume = (word: string): word is keyof typeof VOLUMES => Object.hasOwn(VOLUMES, word)
// A volume as typed, 0 to 1, or null when it is not a whole number. Over 100 is 100.
const parseVolume = (text: string): number | null => (/^\d+$/.test(text) ? Math.min(100, Number(text)) / 100 : null)

const SWITCH_NAMES = `Switches: ${Object.keys(SWITCHES).join(', ')}`
const ON_WORDS: ReadonlySet<string> = new Set(['on', 'unmute'])
const OFF_WORDS: ReadonlySet<string> = new Set(['off', 'mute'])

const status = (s: Settings, isPlayerUp: boolean): string => {
  const state = `${s.isOn ? 'On' : 'Off'} · keys volume ${percent(s.volume)} · chimes volume ${percent(s.chimeVolume)} · ${SWITCHES[s.switch]}`
  const head = isPlayerUp ? state : `${state} · no sound: the player is not running`
  const toggles = (Object.keys(SOUNDS) as Sound[]).map(name => `${name} ${onOff(s[name])}`).join(' · ')
  const groups = `${toggles}\nreply sound: ${s.replySound}\nclaude's switch: ${s.claudeSwitch ?? 'same as yours'}`
  const switches = (Object.keys(SWITCHES) as Switch[]).map(k => `${k === s.switch ? '▸' : ' '} ${k.padEnd(10)} ${SWITCHES[k]}`)
  return [head, groups, '', ...switches, '', USAGE].join('\n')
}

// `isPlayerUp` is whether the sound player answered that it can play; the state line says when it did not.
export const runCommand = (args: string, s: Settings, isPlayerUp = true): CommandResult => {
  const [word = '', value = '', third = ''] = args.trim().toLowerCase().split(/\s+/)
  if (word === '') return { text: status(s, isPlayerUp) }
  if (ON_WORDS.has(word)) return { text: 'Sounds on.', settings: { ...s, isOn: true } }
  if (OFF_WORDS.has(word)) return { text: 'Sounds off. /cues on brings them back.', settings: { ...s, isOn: false } }
  if (word === 'volume' && value === '') {
    return { text: `Keys volume is ${percent(s.volume)}, chimes volume is ${percent(s.chimeVolume)}. /cues volume keys|chimes 0-100 sets one, /cues volume 0-100 sets both.` }
  }
  if (word === 'volume' && isVolume(value)) {
    const { field, label } = VOLUMES[value]
    if (third === '') return { text: `${label} volume is ${percent(s[field])}. /cues volume ${value} 0-100 sets it.` }
    const volume = parseVolume(third)
    if (volume !== null) return { text: `${label} volume ${percent(volume)}.`, settings: { ...s, [field]: volume } }
  }
  const both = word === 'volume' ? parseVolume(value) : null
  if (both !== null) return { text: `Volume ${percent(both)}.`, settings: { ...s, volume: both, chimeVolume: both } }
  if (isSwitch(word)) return { text: `Keys now sound like ${SWITCHES[word]}.`, settings: { ...s, switch: word, keys: true, isOn: true } }
  if (word === 'claude' && isSwitch(value)) {
    return { text: `Claude's keys now sound like ${SWITCHES[value]}.`, settings: { ...s, claude: true, isOn: true, claudeSwitch: value } }
  }
  if (word === 'claude' && value === 'same') return { text: "Claude's keys now sound like yours.", settings: { ...s, claudeSwitch: null } }
  if (word === 'reply' && isReplySound(value)) {
    return { text: `Reply chime is now ${REPLY_SOUNDS[value]}.`, settings: { ...s, reply: true, replySound: value } }
  }
  if (value === 'on' || value === 'off') {
    const isOn = value === 'on'
    if (isSound(word)) return { text: `${SOUNDS[word]} ${value}.`, settings: { ...s, [word]: isOn } }
    if (word === 'chimes') return { text: `Chimes ${value}.`, settings: { ...s, send: isOn, reply: isOn, error: isOn } }
  }
  return { text: `/cues does not know "${args.trim()}".\n\n${USAGE}\n\n${SWITCH_NAMES}` }
}
