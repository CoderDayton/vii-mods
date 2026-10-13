import type { RecentSession, SessionSummary, StoredEntry } from '../types'
import { dateOf, folderOf, headOf as hitHeadOf } from './format'

export type SessionFormatOptions = {
  // How many entries of the session come before the ones given.
  offset: number
  maxChars: number
  entryChars: number
}

const ELLIPSIS = '…'

const timeOf = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const count = (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'}`

const headOf = (s: SessionSummary): string => {
  const days = dateOf(s.first) === dateOf(s.last) ? dateOf(s.first) : `${dateOf(s.first)} to ${dateOf(s.last)}`
  const owner = s.parent === undefined ? '' : `  sub-agent of ${s.parent}`
  return `${s.session}${owner}  ${folderOf(s.project)}  ${days}  ${count(s.entries)}`
}

const lineOf = (e: StoredEntry, width: number): string => {
  const flat = e.text.replace(/\s+/g, ' ').trim()
  return `${timeOf(e.ts)} ${e.kind.padEnd(9)} ${flat.length <= width ? flat : `${flat.slice(0, width).trimEnd()}${ELLIPSIS}`}`
}

// A session as a transcript: one line for each entry, oldest first, times in UTC. When entries are left out,
// by the caller or to fit `maxChars`, the last line names the offset that continues from the last one shown.
export const formatSession = (summary: SessionSummary, entries: readonly StoredEntry[], options: SessionFormatOptions): string => {
  const head = headOf(summary)
  const reserve = 80
  const kept: string[] = []
  let used = head.length
  for (const entry of entries) {
    const line = lineOf(entry, options.entryChars)
    if (used + line.length + 1 > options.maxChars - reserve && kept.length > 0) break
    kept.push(line)
    used += line.length + 1
  }
  if (kept.length === 0 && options.offset > 0) return [head, `${ELLIPSIS} no entries past ${summary.entries}`].join('\n')
  const end = options.offset + kept.length
  const whole = options.offset === 0 && end >= summary.entries
  const foot = whole ? [] : [`${ELLIPSIS} entries ${options.offset + 1} to ${end} of ${summary.entries}${end < summary.entries ? `; go on with offset ${end}` : ''}`]
  return [head, ...kept, ...foot].join('\n')
}

export const formatSessionList = (sessions: readonly SessionSummary[]): string => sessions.map(headOf).join('\n')

const TOPIC_CHARS = 90
const ENDED_CHARS = 140

const flat = (text: string | null, max: number): string => {
  const one = (text ?? '').replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max).trimEnd()}${ELLIPSIS}`
}

// A line for each session: its day, folder and short id, then its title, or else the start of its first prompt.
// A second line says how it ended.
export const formatRecent = (sessions: readonly RecentSession[]): string =>
  sessions
    .map(s => {
      const topic = flat(s.title ?? s.asked, TOPIC_CHARS)
      const ended = flat(s.ended, ENDED_CHARS)
      const head = hitHeadOf({ ts: s.last, project: s.project, session: s.session, ...(topic === '' ? {} : { title: topic }) })
      return ended === '' ? head : `${head}\n  ${'ended'.padEnd(9)} ${ended}`
    })
    .join('\n')
