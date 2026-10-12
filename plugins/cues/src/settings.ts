// The key switches there are recordings of, by folder name under `sounds/keys`.
export const SWITCHES = {
  mxblue: 'Cherry MX Blue',
  mxbrown: 'Cherry MX Brown',
  mxblack: 'Cherry MX Black',
  holypanda: 'Holy Panda',
  topre: 'Topre',
  cream: 'NovelKeys Cream',
  alpaca: 'Alpaca',
  turquoise: 'Turquoise Tealios',
  blackink: 'Gateron Black Ink',
  redink: 'Gateron Red Ink',
  bluealps: 'Blue Alps',
  boxnavy: 'Box Navy',
  buckling: 'Buckling Spring',
} as const

export type Switch = keyof typeof SWITCHES

export const isSwitch = (name: string): name is Switch => Object.hasOwn(SWITCHES, name)

// The sounds the reply chime can be, by clip name under `chimes/`.
export const REPLY_SOUNDS = { bell: 'the bell', notes: 'the two low notes' } as const
export type ReplySound = keyof typeof REPLY_SOUNDS

export const isReplySound = (name: string): name is ReplySound => Object.hasOwn(REPLY_SOUNDS, name)

export type Settings = {
  isOn: boolean
  // How loud the keys are, and how loud the chimes are, each 0 to 1.
  volume: number
  chimeVolume: number
  switch: Switch
  // Key sounds for what the user types, and for what Claude writes.
  keys: boolean
  claude: boolean
  // The switch Claude's keys sound like; null is the user's own switch.
  claudeSwitch: Switch | null
  // The chimes, by name: a prompt sent, a reply landed, a turn failed.
  send: boolean
  reply: boolean
  error: boolean
  replySound: ReplySound
}

export const DEFAULTS: Settings = { isOn: true, volume: 0.7, chimeVolume: 0.7, switch: 'mxbrown', keys: true, claude: false, claudeSwitch: null, send: true, reply: true, error: true, replySound: 'bell' }

// The level a volume setting plays at, both 0 to 1. Loudness is heard roughly as the square of the
// level, so the setting is squared: each step of the setting then sounds like an even step.
export const gainFor = (volume: number): number => volume * volume

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const level = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback)

// Settings as they were saved, each field checked: one that is missing or unusable is the default.
export const restore = (saved: unknown): Settings => {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  const volume = level(s.volume, DEFAULTS.volume)
  return {
    isOn: flag(s.isOn, DEFAULTS.isOn),
    volume,
    // Settings saved with one volume for everything keep sounding as they did.
    chimeVolume: level(s.chimeVolume, volume),
    switch: typeof s.switch === 'string' && isSwitch(s.switch) ? s.switch : DEFAULTS.switch,
    keys: flag(s.keys, DEFAULTS.keys),
    claude: flag(s.claude, DEFAULTS.claude),
    claudeSwitch: typeof s.claudeSwitch === 'string' && isSwitch(s.claudeSwitch) ? s.claudeSwitch : DEFAULTS.claudeSwitch,
    send: flag(s.send, DEFAULTS.send),
    reply: flag(s.reply, DEFAULTS.reply),
    error: flag(s.error, DEFAULTS.error),
    replySound: typeof s.replySound === 'string' && isReplySound(s.replySound) ? s.replySound : DEFAULTS.replySound,
  }
}
