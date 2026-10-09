// Reads a session's transcript to see whether it has replied to its briefing. Claude Code keeps one
// <sessionId>.jsonl per session under projects/<cwd>, where every character but a letter or digit is "-".

export const TAIL_BYTES = 1_048_576

const TAIL = `d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '-')"
tail -c "$2" "$d/$3.jsonl" 2>/dev/null
exit 0`

// Prints the last TAIL_BYTES of the session's transcript, or nothing when there is none.
export const TAIL_ARGV = (dir: string, id: string): string[] => ['sh', '-c', TAIL, 'fleet-board-transcript', dir, String(TAIL_BYTES), id]

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const hasText = (message: unknown): boolean => {
  if (!isObject(message)) return false
  const content = message['content']
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (!isObject(block)) return false
    const text = block['text']
    return block['type'] === 'text' && typeof text === 'string' && text.trim() !== ''
  })
}

// The time of the first text the session wrote at or after `since`, or null. A line that is not whole JSON,
// such as the cut line at the start of the tail, is skipped.
export const replyAfter = (jsonl: string, since: number): number | null => {
  for (const line of jsonl.split('\n')) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(row) || row['type'] !== 'assistant') continue
    const stamp = row['timestamp']
    const at = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
    if (Number.isFinite(at) && at >= since && hasText(row['message'])) return at
  }
  return null
}
