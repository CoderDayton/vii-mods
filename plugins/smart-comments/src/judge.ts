import { commentsOf, extOf, syntaxOf } from './syntax'
import type { Comment } from './syntax'
import { hasRuleWord, newness } from './words'

// `keep` costs nothing, `plain` counts against the limit, `noise` trips the check alone, `doc` is skipped.
export type Kind = 'keep' | 'plain' | 'noise' | 'doc'

export type Judged = { line: number; raw: string; kind: Kind; why: string }

type Verdict = { kind: Kind; why: string }

const MAX_NEW = 1 / 3
// Code lines under a comment that it is compared with.
const CONTEXT_LINES = 2

const DIRECTIVE =
  /^(eslint|tslint|prettier|biome|@ts-|ts-(ignore|expect|nocheck)|istanbul|c8 |v8 |noqa|type: ?ignore|pylint|mypy|pragma|clippy|rustfmt|go:|nolint|shellcheck|safety:|region\b|endregion\b|copyright|spdx|license|todo\b|fixme\b|<reference\b|<amd-|frozen_string_literal|fmt:|ruff:|pyright:|rubocop:|deno-(lint|fmt)|cspell|swiftlint|\+build|@(flow|jsx|generated|vitest-|jest-|vite-))/i

const HISTORY: readonly RegExp[] = [
  /\b(previously|originally|formerly|anymore|any more)\b|\bno longer\b(?! than\b)/i,
  // "used to" right after a pronoun is history; after a noun it names a purpose, as in "a table used to dedupe peers".
  /(^|\b(it|this|that|we|they|which|there|code|function|method) )used to\b|\bused to (be|have)\b/i,
  /\b(was|were|been|got) (changed|moved|renamed|removed|added|replaced|refactored|rewritten|updated)\b/i,
  /^(changed|moved|renamed|removed|added|replaced|refactored|updated|switched|migrated|extracted|rewrote|simplified|cleaned up)\b/i,
  /^fixed\b(?![ -](size|width|length|point|set|number|order|rate|step|seed))/i,
  /\b(instead of the (old|previous)|the old (code|version|way|implementation|approach|call))\b/i,
  /\bas (requested|asked|discussed)\b|\bper (the )?(review|request|feedback|user)\b/i,
  /^now\b|\bnow (uses?|returns?|handles?|supports?|we|it)\b/i,
  /^new:|^newly (added|introduced|created)\b/i,
]

const FIGURE =
  /\d+(\.\d+)?\s?(ms|s|sec|min|h|hz|kb|mb|gb|kib|mib|gib|px|%|x|fps|bytes?|tokens?|chars?|lines?|rows?|items?|entries|times|tries)\b|\d{2,}|\d\.\d|\bO\(/i
const LINK = /https?:\/\/|#\d+\b|\b[A-Z]{2,}-\d+\b|\bRFC ?\d+|§/
const REASON =
  /\b(so that|to (avoid|prevent|stop)|in case|by the time|or else|in order to|as long as|even (if|when|though)|rather than|on purpose|by design|relies on|depends on)\b/i

const CONTRACT =
  /\b(or (null|undefined)|(null|undefined|none) (when|for|if)|[01]-based|which is (how|why)|so (a|an|the|that|they|it|its|their|each|every|two|there|one|no) )\b|^(exit \d|\$\d|arguments?:)|\bin (bytes|bits|characters|columns|cells|rows|pixels|seconds|milliseconds|[km]ib)\b/i

const judgeOne = (c: Comment, code: string): Verdict => {
  if (c.shebang || DIRECTIVE.test(c.text)) return { kind: 'keep', why: 'a tool directive' }
  if (HISTORY.some(r => r.test(c.text))) return { kind: 'noise', why: 'tells the edit story' }
  const fresh = newness(c.text, code)
  if (fresh !== null && fresh <= MAX_NEW) return { kind: 'noise', why: 'repeats the code' }
  if (FIGURE.test(c.text)) return { kind: 'keep', why: 'a measured figure' }
  if (LINK.test(c.text)) return { kind: 'keep', why: 'a link' }
  if (CONTRACT.test(c.text)) return { kind: 'keep', why: 'a contract or a consequence' }
  if (hasRuleWord(c.text) || REASON.test(c.text)) return { kind: 'keep', why: 'a rule or a reason' }
  return { kind: 'plain', why: 'adds little' }
}

// A line that declares something a docstring can sit on. A local const, let or var is not one.
const DECLARES =
  /^(export|default|declare|async|function|class|interface|type|enum|abstract|public|private|protected|static|readonly|override|get|set|pub|fn|struct|impl|trait|mod|unsafe|func|package|namespace|module)\b|^@\w|^#\[|^[\w$]+\s*(<[^>]*>)?\(.*\)\s*(:\s*[^{]+)?\{$|^[\w$]+\??:\s/
const TOP_LEVEL_BINDING = /^(const|let|var)\b/
// A block statement has the shape of a method: a word, brackets, a brace.
const CONTROL = /^(if|for|while|switch|catch)\b/

const C_FAMILY: ReadonlySet<string> = new Set(['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ipp', 'inl'])
const C_STATEMENT = /^(return|if|else|while|for|switch|case|do|throw|delete|new|goto|sizeof|co_return|co_await)\b/
const C_DECLARES =
  /^(struct|union|typedef|template|using|extern|virtual|explicit|inline|constexpr|#\s*define)\b|^(?:[\w:]+(?:<[^>]*>)?[\s*&]+)+[\w:~]+\s*\([^;{]*\)[\w\s]*[{;]?$/
// C and C++: a variable at the top level. Tested on the untrimmed line.
const C_GLOBAL = /^(?:[\w:]+(?:<[^>]*>)?[\s*&]+)+\w+(\[[^\]]*\])?\s*(=.*)?;$/
const GO_NAMED = /^(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)(\w+)/

const declares = (source: string, ext: string): boolean => {
  // The indent is kept, the line end is not: a CRLF file leaves a carriage return on each line.
  const line = source.trimEnd()
  const t = line.trim()
  if (CONTROL.test(t)) return false
  if (DECLARES.test(t) || TOP_LEVEL_BINDING.test(line)) return true
  return C_FAMILY.has(ext) && !C_STATEMENT.test(t) && (C_DECLARES.test(t) || C_GLOBAL.test(line))
}

// Every comment of a file with its verdict, in line order. Empty for a file whose comments are not read.
export const judgeFile = (path: string, text: string, allowDocs: boolean): Judged[] => {
  const syn = syntaxOf(path)
  if (syn === null) return []
  const ext = extOf(path)
  const lines = text.split('\n')
  const { list, lines: commentLines } = commentsOf(text, syn)

  // The first line under the run of comment lines that `line` is in.
  const under = (line: number): string => {
    let n = line
    while (commentLines.has(n + 1)) n++
    return lines[n] ?? ''
  }
  const below = (line: number): string => {
    const got: string[] = []
    for (let i = line; i < lines.length && got.length < CONTEXT_LINES; i++) {
      const source = lines[i] ?? ''
      if (source.trim() !== '' && !commentLines.has(i + 1)) got.push(source)
    }
    return got.join('\n')
  }
  // A docstring sits right on a declaration. In Go it is a plain comment run that starts with the name.
  const isDoc = (c: Comment): boolean => {
    if (c.code !== '') return false
    if (c.doc) return c.raw.startsWith('//!') || declares(under(c.line), ext)
    if (ext !== 'go') return false
    let top = c.line
    while (commentLines.has(top - 1)) top--
    const name = GO_NAMED.exec(under(c.line).trim())?.[1]
    return name !== undefined && list.find(x => x.line >= top)?.text.split(/\s/)[0] === name
  }

  const out: Judged[] = []
  // The verdict of the line above, when it was kept and its sentence has not ended.
  let open: { line: number; why: string } | null = null
  for (const c of list) {
    if (allowDocs && isDoc(c)) {
      open = null
      out.push({ line: c.line, raw: c.raw, kind: 'doc', why: 'a docstring' })
      continue
    }
    let verdict = judgeOne(c, c.code !== '' ? c.code : below(c.line))
    if (verdict.kind === 'plain' && open !== null && open.line === c.line - 1) verdict = { kind: 'keep', why: open.why }
    open = verdict.kind === 'keep' && c.code === '' && !/[.!?:]$/.test(c.text) ? { line: c.line, why: verdict.why } : null
    out.push({ line: c.line, raw: c.raw, ...verdict })
  }
  return out
}

export type Tally = { keep: number; plain: number; noise: number }

export const tallyOf = (judged: readonly Judged[]): Tally => ({
  keep: judged.filter(j => j.kind === 'keep').length,
  plain: judged.filter(j => j.kind === 'plain').length,
  noise: judged.filter(j => j.kind === 'noise').length,
})

const CODE_PER_PLAIN = 20

// How many plain comments an edit may add: the limit, or one for each twenty lines of new code when
// that is more. A limit of zero stays zero.
export const roomFor = (max: number, codeLines: number): number => (max === 0 ? 0 : Math.max(max, Math.floor(codeLines / CODE_PER_PLAIN)))

export const trips = (judged: readonly Judged[], max: number): boolean => {
  const t = tallyOf(judged)
  return t.noise > 0 || t.plain > max
}
