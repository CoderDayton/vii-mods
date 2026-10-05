export type Span = { start: number; end: number }

export type Token = { text: string; start: number; end: number }

const WORD = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g

const PROTECTED = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]+`/g,
  /https?:\/\/[^\s)]+/g,
  /(?<=^|\s)(?:~|\.{1,2})?\/[^\s]+/g,
  /(?<=^|\s)--?[A-Za-z][\w-]*/g,
  /\[Image #\d+\]/g,
]

export const tokenize = (text: string): Token[] =>
  [...text.matchAll(WORD)].map(m => {
    const start = m.index ?? 0
    return { text: m[0], start, end: start + m[0].length }
  })

export const protectedSpans = (text: string): Span[] =>
  PROTECTED.flatMap(re =>
    [...text.matchAll(re)].map(m => {
      const start = m.index ?? 0
      return { start, end: start + m[0].length }
    }),
  )

export const overlaps = (a: Span, spans: readonly Span[]): boolean =>
  spans.some(s => a.start < s.end && s.start < a.end)

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/[\s\-.]+/g, ' ')
    .trim()

export const soundKey = (word: string): string => {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  const merges: [string, string][] = [
    ['ph', 'f'],
    ['ck', 'k'],
    ['c', 'k'],
    ['q', 'k'],
    ['z', 's'],
    ['x', 'ks'],
    ['w', 'v'],
    ['y', 'i'],
  ]
  for (const [from, to] of merges) {
    w = w.split(from).join(to)
  }
  w = w.replace(/(.)\1+/g, '$1')
  return w.slice(0, 1) + w.slice(1).replace(/[aeiou]/g, '')
}

export const at = <T>(list: readonly T[], i: number): T => list[i] as T

export const editDistance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur.push(Math.min(at(prev, j) + 1, at(cur, j - 1) + 1, at(prev, j - 1) + cost))
    }
    prev = cur
  }
  return at(prev, b.length)
}
