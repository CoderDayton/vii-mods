// The words of a command line, split as a shell splits them without expanding anything: on blanks, with
// single or double quotes holding blanks in a word, and a backslash taking the next character as it is.
export const commandWords = (line: string): string[] => {
  const words: string[] = []
  let word = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote !== null) {
      if (c === quote) quote = null
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === '\\') {
      const next = line[++i]
      if (next !== undefined && next !== '\n') {
        word += next
        started = true
      }
    } else if (/\s/.test(c)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (started) words.push(word)
  return words
}
