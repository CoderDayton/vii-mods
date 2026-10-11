import type { Crowd } from './diff'
import { tallyOf } from './judge'
import type { Judged } from './judge'

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

// Line numbers as text, with lines in a row as one range: L1, L3-5.
const linesOf = (judged: readonly Judged[]): string => {
  const lines = judged.map(j => j.line)
  const out: string[] = []
  for (let from = 0; from < lines.length; ) {
    let to = from
    while (lines[to + 1] === lines[to]! + 1) to++
    out.push(to === from ? `L${lines[from]}` : `L${lines[from]}-${lines[to]}`)
    from = to + 1
  }
  return out.join(', ')
}

const byFault = (noise: readonly Judged[]): string =>
  [...new Set(noise.map(j => j.why))].map(why => `${linesOf(noise.filter(j => j.why === why))} (${why})`).join(', ')

const closing = (allowDocs: boolean): string => `A comment should say what the code cannot: a figure, a pitfall or a rule.${allowDocs ? ' Docstrings are fine.' : ''}`

// How many of a file's new comment lines Claude is asked to act on: the noise, and the plain lines
// when they are over the limit or sit in a crowded stretch.
export const flaggedIn = (judged: readonly Judged[], max: number, crowd: Crowd | null): number => {
  const t = tallyOf(judged)
  return t.noise + (t.plain > max || crowd !== null ? t.plain : 0)
}

// What is wrong with the new comments of one file, or null when nothing is. `judged` holds the new
// comments only.
const fileLines = (path: string, judged: readonly Judged[], max: number, crowd: Crowd | null): string[] | null => {
  const tally = tallyOf(judged)
  const noise = judged.filter(j => j.kind === 'noise')
  const plain = judged.filter(j => j.kind === 'plain')
  if (flaggedIn(judged, max, crowd) === 0) return null

  const kept = judged.filter(j => j.kind === 'keep')
  const fine = kept.length === 0 ? '' : `; ${linesOf(kept)} ${kept.length === 1 ? 'is' : 'are'} fine`
  const out = [`smart-comments: ${plural(tally.keep + tally.plain + tally.noise, 'new comment line')} in ${path}${fine}.`]
  if (noise.length > 0) out.push(`Delete or rewrite ${byFault(noise)}.`)
  if (plain.length > max) {
    const stay = max === 0 ? 'delete' : `keep ${max === 1 ? 'one' : max} of`
    out.push(`${plural(plain.length, 'line')} ${plain.length === 1 ? 'adds' : 'add'} little, and the limit is ${max}: ${stay} ${linesOf(plain)}.`)
  } else if (crowd !== null && plain.length > 0) {
    out.push(`L${crowd.from}-${crowd.to} is crowded, ${crowd.comments} of ${crowd.lines} lines are comments that add little: add no more like ${linesOf(plain)}.`)
  }
  return out
}

export type EditReport = { path: string; judged: readonly Judged[]; max: number; crowd: Crowd | null; allowDocs: boolean }

// The note Claude reads after an edit, or null when the edit's comments pass.
export const editNote = (r: EditReport): string | null => {
  const lines = fileLines(r.path, r.judged, r.max, r.crowd)
  return lines === null ? null : [...lines, closing(r.allowDocs)].join('\n')
}

// The first line of the follow-up prompt. A turn whose prompt holds it was started by this mod.
export const FOLLOW_UP = 'smart-comments: comments you added this turn need one more pass.'

export type FileReport = { path: string; judged: readonly Judged[]; max: number }

// The prompt sent when a turn ends with files that still trip, or null when none does.
export const turnPrompt = (files: readonly FileReport[], allowDocs: boolean): string | null => {
  const blocks = files.map(f => fileLines(f.path, f.judged, f.max, null)).filter(b => b !== null)
  if (blocks.length === 0) return null
  return [FOLLOW_UP, ...blocks.flat(), `${closing(allowDocs)} Change these lines and nothing else.`].join('\n')
}
