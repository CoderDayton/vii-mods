import type { HitEntry, SessionHit } from './group'

export type FormatOptions = {
  maxChars: number
  // How many sessions come before these, and how many matched beyond them.
  offset?: number
  more?: number
}

const ENTRY_WIDTH = 260
const CONTEXT_WIDTH = 160
const REPLY_WIDTH = 100
const LABEL_WIDTH = 9
const ELLIPSIS = '…'
// Room kept for the last line, which counts what was left out.
const FOOT_CHARS = 60

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

export const folderOf = (project: string): string => project.split('/').filter(Boolean).pop() ?? '-'

export const dateOf = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

const SHORT_ID = 8

export const headOf = (hit: { ts: number; project: string; session: string; parent?: string }): string =>
  `${dateOf(hit.ts)}  ${folderOf(hit.project)}  ${hit.session.slice(0, SHORT_ID)}${hit.parent === undefined ? '' : `  sub-agent of ${hit.parent.slice(0, SHORT_ID)}`}`

// The leading blocks that fit in `maxChars` with room for a last line; at least one is kept.
export const fitBlocks = (blocks: readonly string[], maxChars: number): string[] => {
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    const next = used + block.length + 2
    if (next > maxChars - FOOT_CHARS && kept.length > 0) break
    kept.push(block)
    used = next
  }
  return kept
}

const line = (label: string, text: string): string => `  ${label.padEnd(LABEL_WIDTH)} ${text}`

const sameText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

const shortPath = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/')

// One session, read as it happened: the files it changed, then each turn that holds a match, oldest first. A
// turn is the prompt that opened it, its matches, the last thing Claude said in it, and what the user typed
// next, which tells whether the answer held. A text is shown once.
const render = (hit: SessionHit, terms: readonly string[]): string => {
  const shown = new Set(hit.entries.map(e => sameText(e.text)))
  const around = (label: string, text: string | undefined, width: number): string[] => {
    if (text === undefined || shown.has(sameText(text))) return []
    shown.add(sameText(text))
    return [line(label, snippetOf(text, terms, width))]
  }
  const turns = new Map<number, HitEntry[]>()
  for (const entry of [...hit.entries].sort((a, b) => a.id - b.id)) turns.set(entry.turn ?? entry.id, [...(turns.get(entry.turn ?? entry.id) ?? []), entry])

  const files = hit.files === undefined || hit.files.length === 0 ? [] : [line('changed', hit.files.map(shortPath).join(', '))]
  const lines = [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, entries]) => {
      const first = entries[0]
      return [
        ...around('asked', first?.asked, CONTEXT_WIDTH),
        ...entries.map(e => line(e.kind, snippetOf(e.text, terms, ENTRY_WIDTH))),
        ...around('ended', first?.ended, CONTEXT_WIDTH),
        ...around('reply', first?.reply, REPLY_WIDTH),
      ]
    })
  return [headOf(hit), ...files, ...lines].join('\n')
}

// The hits as plain text for the model or the terminal, cut to `maxChars`: whole sessions are kept, and a last
// line counts the rest and names the offset that continues after the last one shown.
export const formatHits = (hits: readonly SessionHit[], terms: readonly string[], options: FormatOptions): string => {
  const offset = options.offset ?? 0
  if (hits.length === 0) return offset > 0 ? 'No more sessions match.' : 'No past session matches.'
  const kept = fitBlocks(
    hits.map(h => render(h, terms)),
    options.maxChars,
  )
  const left = hits.length - kept.length + (options.more ?? 0)
  const body = kept.join('\n\n')
  return left === 0 ? body : `${body}\n\n${ELLIPSIS} ${left} more ${left === 1 ? 'session' : 'sessions'}; go on with offset ${offset + kept.length}`
}
