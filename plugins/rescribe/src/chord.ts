const KEY_NAMES: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  opt: 'Alt',
  option: 'Alt',
  meta: 'Alt',
  cmd: 'Cmd',
  command: 'Cmd',
  super: 'Cmd',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
}

const keyName = (key: string): string =>
  KEY_NAMES[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))

export const prettyChord = (chord: string): string =>
  chord
    .trim()
    .split(/\s+/)
    .map(stroke => stroke.split('+').map(keyName).join('+'))
    .join(' ')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The key the person bound to `action` in keybindings.json, written for display; a Global
// binding wins over one in another context. Null when there is none or the file is unreadable.
export const findChord = (json: string, action: string): string | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['bindings'])) return null

  const found: { context: unknown; key: string }[] = []
  for (const block of parsed['bindings'] as unknown[]) {
    if (!isRecord(block) || !isRecord(block['bindings'])) continue
    for (const [key, value] of Object.entries(block['bindings'])) {
      if (value === action) found.push({ context: block['context'], key })
    }
  }
  const pick = found.find(f => f.context === 'Global') ?? found[0]
  return pick === undefined ? null : prettyChord(pick.key)
}
