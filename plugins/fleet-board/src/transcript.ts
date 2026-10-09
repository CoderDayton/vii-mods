// Reads a session's transcript to see whether it has replied to its briefing or echoed a task id. Claude Code keeps one
// <sessionId>.jsonl per session under projects/<cwd>, where every character but a letter or digit is "-".

export const TAIL_BYTES = 1_048_576

const LOCATE = `d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '-')"`

const SIZE = `${LOCATE}
{ wc -c < "$d/$2.jsonl"; } 2>/dev/null || echo 0
exit 0`

const READ = `${LOCATE}
tail -c +$(($3 + 1)) "$d/$2.jsonl" 2>/dev/null
exit 0`

// Byte `from` moved forward to the first byte of a row: past the first newline at or after `from - 1`. A byte offset
// inside a row decodes to replacement characters, so the reader never starts a read there.
const ALIGN = `${LOCATE}
f="$d/$2.jsonl"
if [ "$3" -gt 0 ]; then
  skip=$(tail -c +"$3" "$f" 2>/dev/null | head -n 1 | wc -c)
  echo $(($3 - 1 + skip))
else
  echo 0
fi
exit 0`

// The size of the session's transcript in bytes, 0 when there is none.
export const SIZE_ARGV = (dir: string, id: string): string[] => ['sh', '-c', SIZE, 'fleet-board-size', dir, id]

// The bytes of the session's transcript from byte `from` to its end.
export const READ_ARGV = (dir: string, id: string, from: number): string[] => ['sh', '-c', READ, 'fleet-board-read', dir, id, String(from)]

// The first row boundary at or after byte `from`.
export const ALIGN_ARGV = (dir: string, id: string, from: number): string[] => ['sh', '-c', ALIGN, 'fleet-board-align', dir, id, String(from)]

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const textsOf = (message: unknown): string[] => {
  if (!isObject(message)) return []
  const content = message['content']
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    if (!isObject(block) || block['type'] !== 'text') return []
    const text = block['text']
    return typeof text === 'string' ? [text] : []
  })
}

// The time of the first assistant text at or after `since` that `said` accepts, or null. A line that is not whole
// JSON, such as the cut line at the start of the tail, is skipped.
export const saidAfter = (jsonl: string, since: number, said: (text: string) => boolean): number | null => {
  for (const line of jsonl.split('\n')) {
    const row = rowOf(line)
    if (row === null || row['type'] !== 'assistant') continue
    const at = timeOf(row)
    if (at !== null && at >= since && textsOf(row['message']).some(said)) return at
  }
  return null
}

// The time of the first text the session wrote at or after `since`, or null.
export const replyAfter = (jsonl: string, since: number): number | null => saidAfter(jsonl, since, text => text.trim() !== '')

const rowOf = (line: string): Record<string, unknown> | null => {
  try {
    const row: unknown = JSON.parse(line)
    return isObject(row) ? row : null
  } catch {
    return null
  }
}

const timeOf = (row: Record<string, unknown>): number | null => {
  const stamp = row['timestamp']
  const at = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
  return Number.isFinite(at) ? at : null
}

// Runs `tail -c <bytes>` on a transcript and returns its stdout.
export type Tail = (argv: string[]) => Promise<string>

// True when the earliest timestamped row in the text is before `since`, so the text reaches back to `since`.
const reachesBack = (jsonl: string, since: number): boolean => {
  for (const line of jsonl.split('\n')) {
    const row = rowOf(line)
    const at = row === null ? null : timeOf(row)
    if (at !== null) return at < since
  }
  return false
}

// An assistant text and the time it was written.
export type Text = { at: number; text: string }

// The whole rows of a chunk: through its last newline, and the last line too when it already parses, so a row written
// without a newline yet is taken only once it is whole.
const wholeRows = (chunk: string): string => {
  const cut = chunk.lastIndexOf('\n') + 1
  return rowOf(chunk.slice(cut)) === null ? chunk.slice(0, cut) : chunk
}

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

// What the reader holds for one session and one `since`: the byte offset it has read up to, and the texts found.
type Seen = { pos: number; texts: Text[] }

// Reads a session's transcript in place. The first read finds the window that reaches back to `since`; each later read
// takes only the bytes after the last whole row it kept.
export const createTranscriptReader = (run: Tail) => {
  const seen = new Map<string, Seen>()

  const sizeOf = async (dir: string, id: string): Promise<number> => Number((await run(SIZE_ARGV(dir, id))).trim()) || 0

  const alignOf = async (dir: string, id: string, from: number): Promise<number> =>
    from === 0 ? 0 : Number((await run(ALIGN_ARGV(dir, id, from))).trim()) || 0

  // The window starts on a row boundary, so its text is exact bytes and `pos` counts them exactly.
  const firstRead = async (dir: string, id: string, since: number, size: number): Promise<Seen> => {
    for (let bytes = TAIL_BYTES; ; bytes *= 2) {
      const from = await alignOf(dir, id, Math.max(0, size - bytes))
      const chunk = await run(READ_ARGV(dir, id, from))
      if (from === 0 || reachesBack(chunk, since)) {
        const whole = wholeRows(chunk)
        return { pos: from + bytesOf(whole), texts: textsIn(whole, since) }
      }
    }
  }

  return {
    // Drops the cursor for one `since`, or every cursor kept for the session when `since` is not given.
    forget: (dir: string, id: string, since?: number): void => {
      const prefix = `${dir}\n${id}\n`
      for (const key of [...seen.keys()]) {
        if (since === undefined ? key.startsWith(prefix) : key === `${prefix}${since}`) seen.delete(key)
      }
    },
    texts: async (dir: string, id: string, since: number): Promise<Text[]> => {
      if (dir === '') return []
      const key = `${dir}\n${id}\n${since}`
      const size = await sizeOf(dir, id)
      const prev = seen.get(key)
      if (prev !== undefined && prev.pos === size) return prev.texts
      let next: Seen
      if (prev === undefined || prev.pos > size) {
        next = await firstRead(dir, id, since, size)
      } else {
        const whole = wholeRows(await run(READ_ARGV(dir, id, prev.pos)))
        next = { pos: prev.pos + bytesOf(whole), texts: [...prev.texts, ...textsIn(whole, since)] }
      }
      seen.set(key, next)
      return next.texts
    },
  }
}

// A line the employee asks with: it has a question mark, or starts with "question" or "need".
// URLs are taken out first, so a "?" in a query string does not count.
export const isQuestion = (text: string): boolean => {
  const plain = text.replace(/\S+:\/\/\S+/g, ' ').trim()
  return /^(question|need)\b/i.test(plain) || /\?(\s|$)/.test(plain)
}

const LINE_MAX = 160

// The first non-empty line of a text, cut to 160 characters.
export const lineOf = (text: string): string => {
  const line = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1)}…`
}

export const REPLY_MAX = 1500

// The text of a reply up to and including the line `echo` accepts, or the whole text when no line does. A text
// longer than REPLY_MAX keeps its end and starts with an ellipsis.
export const replyOf = (text: string, echo?: RegExp): string => {
  const lines = text.split('\n')
  const at = echo === undefined ? -1 : lines.findIndex(line => echo.test(line))
  const kept = (at === -1 ? lines : lines.slice(0, at + 1)).join('\n').trim()
  return kept.length <= REPLY_MAX ? kept : `…${kept.slice(kept.length - (REPLY_MAX - 1))}`
}

// Every assistant text in the window at or after `since`, in order.
const textsIn = (jsonl: string, since: number): Text[] => {
  const out: Text[] = []
  for (const line of jsonl.split('\n')) {
    const row = rowOf(line)
    if (row === null || row['type'] !== 'assistant') continue
    const at = timeOf(row)
    if (at === null || at < since) continue
    for (const text of textsOf(row['message'])) out.push({ at, text })
  }
  return out
}

// Every assistant text at or after `since`, in order, from a fresh reader.
export const transcriptTexts = async (tail: Tail, dir: string, id: string, since: number): Promise<Text[]> =>
  createTranscriptReader(tail).texts(dir, id, since)

// The time of the first assistant text at or after `since` that `said` accepts, or null. The tail starts at
// TAIL_BYTES and doubles until it reaches back to `since` or covers the whole transcript.
export const transcriptSaid = async (
  tail: Tail,
  dir: string,
  id: string,
  since: number,
  said: (text: string) => boolean,
): Promise<number | null> => {
  const found = (await transcriptTexts(tail, dir, id, since)).find(t => said(t.text))
  return found?.at ?? null
}
