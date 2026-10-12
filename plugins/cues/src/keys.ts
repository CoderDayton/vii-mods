export type KeyClip = 'r0' | 'r1' | 'r2' | 'r3' | 'r4' | 'space' | 'enter' | 'backspace'

const ROWS = ['1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'] as const
const SHIFTED_DIGITS = '!@#$%^&*()_+'
const ROW_CLIPS = ['r0', 'r1', 'r2', 'r3'] as const
// What a switch with no recording of a wide key plays for it.
const WIDE_FALLBACK = { space: 'r4', enter: 'r2', backspace: 'r2' } as const

const isWide = (clip: KeyClip): clip is keyof typeof WIDE_FALLBACK => Object.hasOwn(WIDE_FALLBACK, clip)

export const clipForChar = (char: string): KeyClip => {
  if (char === ' ' || char === '\t') return 'space'
  if (char === '\n' || char === '\r') return 'enter'
  if (SHIFTED_DIGITS.includes(char)) return 'r0'
  const row = ROWS.findIndex(keys => keys.includes(char.toLowerCase()))
  return ROW_CLIPS[row] ?? 'r4'
}

// `key` is a key name as `prompt.edit` gives it: one character, or a word such as `backspace`.
export const clipForKey = (key: string): KeyClip => {
  const name = key.toLowerCase()
  if (name === 'space') return 'space'
  if (name === 'return' || name === 'enter') return 'enter'
  if (name === 'backspace' || name === 'delete') return 'backspace'
  return name.length === 1 ? clipForChar(name) : 'r4'
}

// The clips to try for a press, first one that exists wins.
export const pressClips = (switchName: string, clip: KeyClip): string[] => {
  const base = `keys/${switchName}/press`
  return isWide(clip) ? [`${base}/${clip}`, `${base}/${WIDE_FALLBACK[clip]}`] : [`${base}/${clip}`]
}

export const releaseClips = (switchName: string, clip: KeyClip): string[] => {
  const base = `keys/${switchName}/release`
  return isWide(clip) ? [`${base}/${clip}`, `${base}/key`] : [`${base}/key`]
}
