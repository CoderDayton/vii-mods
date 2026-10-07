// One line of plain text: control characters dropped, runs of whitespace made one space.
export const flatten = (text: string): string =>
  text
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const oneLine = (text: string, max: number): string => clip(flatten(text), max)

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon'?t\b/g, 'will not'],
  [/\bcan'?t\b/g, 'can not'],
  [/\b(do|does|did|is|are|was|were|has|have|should|could|would)n'?t\b/g, '$1 not'],
]

// Lower case, contractions spelled out, punctuation gone: the words a sentence says.
export const wordsOf = (text: string): string[] => {
  let s = text.toLowerCase().replace(/[’‘]/g, "'")
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to)
  return s.match(/[a-z0-9]+/g) ?? []
}
