// Claude Code keeps the prompts you send in <config dir>/history.jsonl, one JSON object per line, and
// the Up arrow reads them. Writing the original draft there lets Up bring it back after an enhance.
// The file's format is Claude Code's own, so the keys are learned from its latest entries each time.

const TAIL_LINES = 30

export type Shape = { template: Record<string, unknown> }

export type EntryInput = { text: string; now: number; project: string; sessionId: string }

type Entry = Record<string, unknown>

export const historyPathOf = (dir: string): string => `${dir}/history.jsonl`

export const tailArgv = (path: string): string[] => ['tail', '-n', String(TAIL_LINES), path]

// $1 is the file, $2 the line. Nothing is created, and a last line left without its newline is closed first.
const APPEND = `[ -f "$1" ] && [ -w "$1" ] || exit 2
[ -z "$(tail -c1 "$1")" ] || printf '\\n' >> "$1"
printf '%s\\n' "$2" >> "$1"`

export const appendArgv = (path: string, line: string): string[] => ['sh', '-c', APPEND, 'rescribe-history', path, line]

// Pasted text and images live beside the entry, not in its text, so a draft that holds them cannot be stored whole.
const ATTACHMENT = /\[(?:Pasted text|Image|Truncated text)\b[^\]]*\]/i

export const hasAttachments = (text: string): boolean => ATTACHMENT.test(text)

const entryOf = (raw: string): Entry | null => {
  try {
    const data: unknown = JSON.parse(raw)
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Entry) : null
  } catch {
    return null
  }
}

const isUsable = (e: Entry): boolean => typeof e['display'] === 'string' && typeof e['timestamp'] === 'number'

const signature = (e: Entry): string => Object.keys(e).sort().join(',')

// The entry layout the file uses now: the commonest set of keys among its last lines, newest entry as the model.
export const learnShape = (tail: string): Shape | null => {
  const entries = tail.split('\n').map(entryOf).filter((e): e is Entry => e !== null && isUsable(e))
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(signature(e), (counts.get(signature(e)) ?? 0) + 1)
  let best: Entry | null = null
  let bestCount = 0
  for (const e of entries) {
    const n = counts.get(signature(e)) ?? 0
    if (n >= bestCount) {
      best = e
      bestCount = n
    }
  }
  return best === null ? null : { template: best }
}

const emptyLike = (value: unknown): unknown => {
  if (typeof value === 'string') return ''
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  if (Array.isArray(value)) return []
  if (typeof value === 'object' && value !== null) return {}
  return null
}

// One line of JSON in the layout of `shape`: the keys it holds, in its order. Keys we know get our values;
// any other gets an empty value of its type.
export const buildEntry = (shape: Shape, input: EntryInput): string => {
  const known: Record<string, unknown> = {
    display: input.text,
    timestamp: input.now,
    project: input.project,
    sessionId: input.sessionId,
    pastedContents: {},
  }
  const entry: Entry = {}
  for (const [key, value] of Object.entries(shape.template)) entry[key] = key in known ? known[key] : emptyLike(value)
  return JSON.stringify(entry)
}
