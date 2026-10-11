import type { SessionHit } from './group'

export type FormatOptions = { maxChars: number }

const ENTRY_WIDTH = 220
const ELLIPSIS = '…'

// A window of `width` characters of the text, starting a little before the first term it holds, on one line.
export const snippetOf = (text: string, terms: readonly string[], width: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= width) return flat
  const lower = flat.toLowerCase()
  const found = terms.map(t => lower.indexOf(t.toLowerCase())).filter(i => i >= 0)
  const first = found.length === 0 ? 0 : Math.min(...found)
  const start = Math.max(0, first - Math.floor(width * 0.3))
  const end = Math.min(flat.length, start + width)
  return `${start > 0 ? ELLIPSIS : ''}${flat.slice(start, end).trim()}${end < flat.length ? ELLIPSIS : ''}`
}

const folderOf = (project: string): string => project.split('/').filter(Boolean).pop() ?? '-'

const dateOf = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

const render = (hit: SessionHit, terms: readonly string[]): string => {
  const head = `${dateOf(hit.ts)}  ${folderOf(hit.project)}  ${hit.session.slice(0, 8)}`
  const lines = hit.entries.map(e => `  ${e.kind.padEnd(9)} ${snippetOf(e.text, terms, ENTRY_WIDTH)}`)
  return [head, ...lines].join('\n')
}

// The hits as plain text for the model or the terminal, cut to `maxChars`: whole sessions are kept, and the
// rest are counted on a last line.
export const formatHits = (hits: readonly SessionHit[], terms: readonly string[], options: FormatOptions): string => {
  if (hits.length === 0) return 'No past session matches.'
  const blocks = hits.map(h => render(h, terms))
  const reserve = 24
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    const next = used + block.length + 2
    if (next > options.maxChars - reserve && kept.length < blocks.length) break
    kept.push(block)
    used = next
  }
  const left = blocks.length - kept.length
  return left === 0 ? kept.join('\n\n') : `${kept.join('\n\n')}\n\n… ${left} more`
}
