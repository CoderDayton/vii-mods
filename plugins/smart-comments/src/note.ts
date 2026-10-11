import type { Crowd } from './diff'
import { tallyOf } from './judge'
import type { Judged } from './judge'

const MAX_SHOWN = 64

const clip = (s: string): string => (s.length > MAX_SHOWN ? `${s.slice(0, MAX_SHOWN - 1)}…` : s)
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
const at = (j: Judged): string => `L${j.line}`.padEnd(5)

const closing = (allowDocs: boolean): string =>
  `A comment earns its place when it tells the reader what the code cannot: a measured figure, a pitfall, or a rule that must hold.${allowDocs ? ' Docstrings are fine.' : ''}`

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

  const out = [`smart-comments: ${plural(tally.keep + tally.plain + tally.noise, 'new comment line')} in ${path}.`]
  if (noise.length > 0) {
    out.push(`Delete ${noise.length === 1 ? 'this one, or rewrite it' : `these ${noise.length}, or rewrite them`} to say what the code cannot:`)
    for (const j of noise) out.push(`  ${at(j)} ${j.why.padEnd(20)}  ${clip(j.raw)}`)
  }
  if (plain.length > max) {
    const stay = max === 0 ? 'Delete them:' : `Keep the ${max === 1 ? 'one' : max} a reader needs most:`
    out.push(`${plural(plain.length, 'line')} ${plain.length === 1 ? 'adds' : 'add'} little, and the limit is ${max}. ${stay}`)
    for (const j of plain) out.push(`  ${at(j)} ${clip(j.raw)}`)
  } else if (crowd !== null && plain.length > 0) {
    out.push(`Lines ${crowd.from} to ${crowd.to} are crowded: ${crowd.comments} of ${crowd.lines} lines are comments that add little. Add no more there:`)
    for (const j of plain) out.push(`  ${at(j)} ${clip(j.raw)}`)
  }
  const kept = judged.filter(j => j.kind === 'keep').map(j => `L${j.line}`)
  if (kept.length > 0) {
    out.push(`Leave ${kept.join(', ')} as ${kept.length === 1 ? 'it is: it records' : 'they are: they record'} what the code cannot say.`)
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
  return [FOLLOW_UP, ...blocks.flat(), closing(allowDocs), 'Change these lines and nothing else.'].join('\n')
}
