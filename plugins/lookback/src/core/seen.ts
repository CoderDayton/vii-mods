// A line shorter than this is too common to stand for text already sent.
const MIN_LINE = 40

export const ALREADY_SENT = 'already sent by an earlier search this session; read the session by its id if you no longer see it'

// Cuts from a search result the lines an earlier result of this session sent. Blocks are separated by a blank
// line, and each keeps its first line, which names the session. `sent` is what the result sends anew.
export const cutSent = (text: string, seen: ReadonlySet<string>): { text: string; sent: string[] } => {
  const sent: string[] = []
  const blocks = text.split('\n\n').map(block => {
    const [head = '', ...rest] = block.split('\n')
    let cut = 0
    const kept = rest.filter(line => {
      const key = line.trim()
      if (key.length < MIN_LINE) return true
      if (seen.has(key)) {
        cut++
        return false
      }
      sent.push(key)
      return true
    })
    if (cut === 0) return block
    if (kept.length === 0) return `${head}\n  ${ALREADY_SENT}`
    return [head, ...kept, `  … ${cut} more line${cut === 1 ? '' : 's'} ${ALREADY_SENT}`].join('\n')
  })
  return { text: blocks.join('\n\n'), sent }
}
