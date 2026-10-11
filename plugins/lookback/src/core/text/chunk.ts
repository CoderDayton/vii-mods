export type ChunkOptions = {
  maxChars?: number
  maxChunks?: number
}

const DEFAULTS = { maxChars: 1200, maxChunks: 4 }

const SENTENCE_END = /(?<=[.!?])\s+/

// Splits text that is longer than `max` at a sentence end, else at a space, else in the middle of a word.
const splitLong = (text: string, max: number): string[] => {
  const pieces: string[] = []
  for (const sentence of text.split(SENTENCE_END)) {
    let rest = sentence
    while (rest.length > max) {
      const space = rest.lastIndexOf(' ', max)
      const at = space > 0 ? space : max
      pieces.push(rest.slice(0, at))
      rest = rest.slice(at).trimStart()
    }
    if (rest !== '') pieces.push(rest)
  }
  return pack(pieces, max, ' ')
}

// Joins consecutive pieces with `glue` while the result stays within `max`.
const pack = (pieces: readonly string[], max: number, glue: string): string[] => {
  const out: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current === '') current = piece
    else if (current.length + glue.length + piece.length <= max) current += glue + piece
    else {
      out.push(current)
      current = piece
    }
  }
  if (current !== '') out.push(current)
  return out
}

// The passages of a text that are embedded one by one: whole paragraphs where they fit, else whole sentences.
// Only the first `maxChunks` are kept; the start of a message says what it is about.
export const chunksOf = (text: string, options: ChunkOptions = {}): string[] => {
  const { maxChars, maxChunks } = { ...DEFAULTS, ...options }
  const pieces = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p !== '')
    .flatMap(p => (p.length > maxChars ? splitLong(p, maxChars) : [p]))
  return pack(pieces, maxChars, '\n\n').slice(0, maxChunks)
}
