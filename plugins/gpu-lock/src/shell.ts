export type Segment = { text: string; words: string[] }

export type Scanned = { segments: Segment[]; comments: string[] }

export const quote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`

const SEPARATORS = new Set([';', '|', '&', '\n', '(', ')', '`'])
const HEREDOC = /^<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/

const heredocBody = (command: string, from: number, end: string, strip: boolean): { body: string; next: number } => {
  let body = ''
  let i = from
  while (i < command.length) {
    const stop = command.indexOf('\n', i)
    const line = command.slice(i, stop === -1 ? command.length : stop)
    i = stop === -1 ? command.length : stop + 1
    if ((strip ? line.replace(/^\t+/, '') : line) === end) break
    body += `${line}\n`
  }
  return { body, next: i }
}

export const scan = (command: string): Scanned => {
  const segments: Segment[] = []
  const comments: string[] = []
  let text = ''
  let words: string[] = []
  let word = ''
  let inWord = false
  let open: '"' | "'" | null = null
  let heredoc: { end: string; strip: boolean; at: number } | null = null
  let i = 0

  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    const trimmed = text.trim()
    if (trimmed !== '' || words.length > 0) segments.push({ text: trimmed, words })
    text = ''
    words = []
  }
  const readBody = () => {
    if (heredoc === null) return
    const { end, strip, at } = heredoc
    heredoc = null
    const read = heredocBody(command, i, end, strip)
    i = read.next
    const body = read.body
    const owner = segments[at]
    if (owner !== undefined) owner.text += `\n${body}`
  }

  while (i < command.length) {
    const c = command.charAt(i)

    if (open === "'") {
      text += c
      if (c === "'") open = null
      else word += c
      i += 1
      continue
    }
    if (open === '"') {
      if (c === '\\' && i + 1 < command.length) {
        text += c + command.charAt(i + 1)
        word += command.charAt(i + 1)
        i += 2
        continue
      }
      text += c
      if (c === '"') open = null
      else word += c
      i += 1
      continue
    }

    if (c === '\\' && i + 1 < command.length) {
      text += c + command.charAt(i + 1)
      word += command.charAt(i + 1)
      inWord = true
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      open = c
      text += c
      inWord = true
      i += 1
      continue
    }
    if (c === '#' && !inWord) {
      const stop = command.indexOf('\n', i)
      const end = stop === -1 ? command.length : stop
      comments.push(command.slice(i + 1, end).trim())
      i = end
      continue
    }
    if (c === '<' && command.charAt(i + 1) === '<' && command.charAt(i + 2) !== '<') {
      const m = HEREDOC.exec(command.slice(i))
      if (m !== null) {
        heredoc = { end: m[2] ?? '', strip: command.charAt(i + 2) === '-', at: segments.length }
      }
    }
    if (SEPARATORS.has(c)) {
      const isRedirect = c === '&' && (command.charAt(i + 1) === '>' || command.charAt(i - 1) === '>')
      if (isRedirect) {
        text += c
        word += c
        inWord = true
        i += 1
        continue
      }
      const isNewline = c === '\n'
      i += 1
      if (c === '&' && command.charAt(i) === '&') i += 1
      if (c === '|' && command.charAt(i) === '|') i += 1
      endSegment()
      if (isNewline) readBody()
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      text += c
      endWord()
      i += 1
      continue
    }
    text += c
    word += c
    inWord = true
    i += 1
  }
  endSegment()
  return { segments, comments }
}
