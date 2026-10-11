export type Syntax = { line: string; block: readonly [string, string] | null }

type Family = Syntax & { ext: readonly string[] }

const C_BLOCK = ['/*', '*/'] as const

const FAMILIES: readonly Family[] = [
  {
    line: '//',
    block: C_BLOCK,
    ext: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ipp', 'inl', 'java', 'kt', 'swift', 'cs', 'php', 'scala', 'dart', 'zig'],
  },
  { line: '#', block: null, ext: ['py', 'rb', 'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'pl', 'r', 'ex', 'exs', 'nix'] },
  { line: '--', block: null, ext: ['lua', 'sql', 'hs'] },
]

export const extOf = (path: string): string => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase()

// The comment syntax of a file, by its ending. Null for a file whose comments are not read.
export const syntaxOf = (path: string): Syntax | null => FAMILIES.find(f => f.ext.includes(extOf(path))) ?? null

export type Comment = {
  // 1-based.
  line: number
  text: string
  // The comment as written, marker included, without the code before it.
  raw: string
  // The code a trailing comment shares its line with; empty for a line that is all comment.
  code: string
  // Written in docstring form: `/**`, `/*!`, `///` or `//!`.
  doc: boolean
  shebang: boolean
}

// `lines` holds every line that is all comment, the empty lines of a block too.
export type Comments = { list: Comment[]; lines: Set<number> }

// A marker after an odd count of quotes sits inside a string.
const evenQuotes = (s: string): boolean => ['"', "'", '`'].every(q => s.split(q).length % 2 === 1)

export const commentsOf = (text: string, syn: Syntax): Comments => {
  const list: Comment[] = []
  const lines = new Set<number>()
  const [open, close] = syn.block ?? ['', '']
  let inBlock = false
  let docBlock = false
  text.split('\n').forEach((source, i) => {
    const t = source.trim()
    const push = (body: string, code = '', doc = false): void => {
      if (code === '') lines.add(i + 1)
      const clean = body.replace(/^[\s*!/#-]+/, '').trim()
      if (clean !== '') list.push({ line: i + 1, text: clean, raw: t.slice(code.length).trim(), code, doc, shebang: false })
    }
    if (inBlock) {
      const end = t.indexOf(close)
      if (end >= 0) inBlock = false
      push(end >= 0 ? t.slice(0, end) : t, '', docBlock)
    } else if (open !== '' && t.startsWith(open)) {
      docBlock = /^\/\*[*!](?!\/)/.test(t)
      const rest = t.slice(open.length)
      const end = rest.indexOf(close)
      if (end < 0) inBlock = true
      push(end >= 0 ? rest.slice(0, end) : rest, '', docBlock)
    } else if (t.startsWith(syn.line)) {
      lines.add(i + 1)
      if (i === 0 && t.startsWith('#!')) list.push({ line: 1, text: t, raw: t, code: '', doc: false, shebang: true })
      else push(t.slice(syn.line.length), '', syn.line === '//' && /^\/\/[/!](?!\/)/.test(t))
    } else {
      const at = t.indexOf(` ${syn.line} `)
      if (at > 0 && evenQuotes(t.slice(0, at))) push(t.slice(at + syn.line.length + 1), t.slice(0, at))
    }
  })
  return { list, lines }
}
