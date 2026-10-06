export type Token = { text: string; start: number; end: number }

const WORD = /[\p{L}\p{N}]+(?:'\p{L}+)?/gu

export const tokenize = (text: string): Token[] =>
  [...text.matchAll(WORD)].map(m => {
    const start = m.index ?? 0
    return { text: m[0], start, end: start + m[0].length }
  })

export const at = <T>(list: readonly T[], i: number): T => list[i] as T
