import { baseName, fmtAge } from './peers'
import type { Peer, PeerState } from './peers'
import { roleOf } from './roles'
import type { Hire, Note } from './fleet'
import { quietSince, STALE_MS } from './team'
import { isQuestion, lineOf } from './transcript'
import type { Task, TaskStatus } from '../types'

export type Flag = 'asked' | 'stale' | ''

export type Row = {
  n: number
  id: string
  name: string
  folder: string
  state: PeerState
  age: string
  isQuiet: boolean
  role: string
  // True until a team member's transcript shows a reply to its briefing.
  waiting: boolean
  // The team member's task id and status, and its whole reply. Empty when there is none.
  taskId: string
  status: TaskStatus | ''
  flag: Flag
  last: string
}

const roleText = (hire: Hire | undefined): string => (hire === undefined ? undefined : roleOf(hire.role)?.label) ?? '—'

// A sent task is asked when its newest line is a question, and stale when it has been quiet for STALE_MS.
const flagOf = (task: Task | undefined, now: number): Flag => {
  if (task === undefined || task.status !== 'sent') return ''
  if (task.last !== undefined && isQuestion(lineOf(task.last))) return 'asked'
  return now - quietSince(task) > STALE_MS ? 'stale' : ''
}

// A working session that has not changed state for the quiet time is the one to look at.
export const rowsOf = (peers: readonly Peer[], roster: Readonly<Record<string, Hire>>, now: number, quietMs: number): Row[] =>
  peers.map((p, i) => {
    const hire = roster[p.id]
    const since = now - p.updatedAt
    return {
      n: i + 1,
      id: p.id,
      name: p.name,
      folder: baseName(p.dir),
      state: p.state,
      age: fmtAge(since),
      isQuiet: p.state === 'working' && since > quietMs,
      role: roleText(hire),
      waiting: hire !== undefined && hire.readyAt === undefined,
      taskId: hire?.task?.id ?? '',
      status: hire?.task?.status ?? '',
      flag: flagOf(hire?.task, now),
      last: hire?.task?.last ?? '',
    }
  })

export const headline = (rows: readonly Row[]): string => {
  if (rows.length === 0) return 'no other sessions'
  const working = rows.filter(r => r.state === 'working').length
  const team = rows.filter(r => r.role !== '—').length
  return `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}  ${working} working  ${team} on team`
}

// The pane as lines of styled text. paneView draws it with bordered Boxes, and textOf draws it as plain text with the
// same borders and padding, so a test can check the widths.
export type Tone = 'plain' | 'bold' | 'dim' | 'success' | 'error' | 'warning'
export type Seg = { text: string; tone: Tone }
export type Line = Seg[]
export type Section = { title: string; lines: Line[] }
export type Frame = { header: Line; sections: Section[]; footer: Line }

// The Button labels. The terminal draws "[ label ]" around a label itself, so the labels carry no brackets and the
// plain-text frame adds the one pair.
export const REFRESH_LABEL = 'refresh'
export const CLOSE_LABEL = 'close'

// The pane Box: a border and a padding of 1 on each side. A section Box inside it has the same.
const PANE_CHROME = 4
const SECTION_CHROME = 4
const MIN_BODY = 20

export const bodyColumns = (columns: number): number => Math.max(MIN_BODY, columns - PANE_CHROME - SECTION_CHROME)

const cut = (text: string, max: number): string => (text.length <= max ? text : max <= 1 ? text.slice(0, Math.max(0, max)) : `${text.slice(0, max - 1)}…`)

const fit = (line: Line, width: number): Line => {
  const out: Line = []
  let left = width
  for (const seg of line) {
    if (left <= 0) break
    out.push(seg.text.length <= left ? seg : { text: cut(seg.text, left), tone: seg.tone })
    left -= seg.text.length
  }
  return out
}

const seg = (text: string, tone: Tone = 'plain'): Seg => ({ text, tone })

const WORD = 8

// The text broken into lines of at most `width` characters: on spaces, a word longer than a line broken hard, and the
// line breaks of the text kept.
export const wrap = (text: string, width: number): string[] =>
  text.split('\n').flatMap(line => {
    const out: string[] = []
    let current = ''
    for (let word of line.split(/\s+/).filter(w => w !== '')) {
      while (word.length > width) {
        if (current !== '') out.push(current)
        current = ''
        out.push(word.slice(0, width))
        word = word.slice(width)
      }
      if (current === '') current = word
      else if (current.length + 1 + word.length <= width) current += ` ${word}`
      else {
        out.push(current)
        current = word
      }
    }
    if (current !== '' || out.length === 0) out.push(current)
    return out
  })

const REPLY_LINES = 12
const NOTE_LINES = 4

const capped = (lines: string[], cap: number): string[] => {
  if (lines.length <= cap) return lines
  const left = lines.length - cap
  return [...lines.slice(0, cap), `... ${left} more ${left === 1 ? 'line' : 'lines'}`]
}

const wordTone: Record<string, Tone> = { done: 'success', blocked: 'error', asked: 'warning', stale: 'warning', sent: 'plain' }

// A team member: the state word first, then the name, role and task id, with the first line of its reply under it.
const memberLines = (r: Row, width: number): Line[] => {
  const word = r.flag !== '' ? r.flag : r.status !== '' ? r.status : 'no task'
  const head: Line = [
    seg(word.padEnd(WORD), wordTone[word] ?? 'dim'),
    seg(r.name, 'bold'),
    seg(`  ${r.role}, ${r.waiting ? 'waiting' : 'ready'}${r.taskId === '' ? '' : `  task ${r.taskId}`}`, 'dim'),
  ]
  const reply = r.last === '' ? [] : capped(wrap(r.last, width - WORD), REPLY_LINES)
  return [fit(head, width), ...reply.map(text => fit([seg(' '.repeat(WORD) + text, 'dim')], width))]
}

const NAME_MAX = 24
const STATE_W = 7
const GAP = 2
const FOLDER_MIN = 6

// Name, state, quiet time and folder in aligned columns that add up to `width`; the last column is cut, not wrapped.
const tableLines = (rows: readonly Row[], width: number): Line[] => {
  const ageOf = (r: Row): string => (r.isQuiet ? `${r.age} !` : r.age)
  const quietW = Math.max(5, ...rows.map(r => ageOf(r).length))
  const avail = width - STATE_W - quietW - 3 * GAP
  const nameW = Math.max(4, Math.min(NAME_MAX, ...[Math.max(...rows.map(r => r.name.length))], avail - FOLDER_MIN))
  const folderW = Math.max(0, avail - nameW)
  const gap = ' '.repeat(GAP)
  const cells = (name: string, state: string, quiet: string, folder: string, tone: Tone, stateTone: Tone): Line => [
    seg(cut(name, nameW).padEnd(nameW), tone),
    seg(gap),
    seg(state.padEnd(STATE_W), stateTone),
    seg(gap),
    seg(quiet.padEnd(quietW), 'dim'),
    seg(gap),
    seg(cut(folder, folderW), 'dim'),
  ]
  return [
    cells('name', 'state', 'quiet', 'folder', 'dim', 'dim'),
    ...rows.map(r => cells(r.name, r.state, ageOf(r), r.folder, 'plain', r.isQuiet ? 'warning' : r.state === 'idle' ? 'dim' : 'plain')),
  ]
}

const NOTE_WORD = 7

// A note: ok or failed first, then its text wrapped under it.
const noteLines = (n: Note, width: number): Line[] =>
  capped(wrap(n.text, width - NOTE_WORD), NOTE_LINES).map((text, i) => [
    i === 0 ? seg((n.ok ? 'ok' : 'failed').padEnd(NOTE_WORD), n.ok ? 'success' : 'error') : seg(' '.repeat(NOTE_WORD)),
    seg(text, 'dim'),
  ])

export const frameOf = (rows: readonly Row[], notes: readonly Note[], columns: number): Frame => {
  const width = bodyColumns(columns)
  const edge = Math.max(MIN_BODY, columns - PANE_CHROME)
  const team = rows.filter(r => r.role !== '—')
  const others = rows.filter(r => r.role === '—')
  const sections: Section[] = []
  if (team.length > 0) {
    sections.push({ title: 'team', lines: team.flatMap((r, i) => (i === 0 ? memberLines(r, width) : [[], ...memberLines(r, width)])) })
  }
  sections.push({ title: 'other sessions', lines: others.length > 0 ? tableLines(others, width) : [[seg('no other sessions', 'dim')]] })
  if (notes.length > 0) sections.push({ title: 'notes', lines: notes.flatMap(n => noteLines(n, width)) })
  return {
    header: fit([seg('fleet', 'bold'), seg(`  ${headline(rows)}`, 'dim')], edge),
    sections,
    footer: fit([seg(`[ ${REFRESH_LABEL} ]  [ ${CLOSE_LABEL} ]  `), seg('esc closes', 'dim')], edge),
  }
}

const plain = (line: Line): string => line.map(s => s.text).join('')

const boxed = (rows: string[], width: number): string[] => [
  `╭${'─'.repeat(width - 2)}╮`,
  ...rows.map(r => `│ ${r.padEnd(width - 4)} │`),
  `╰${'─'.repeat(width - 2)}╯`,
]

export const textOf = (frame: Frame, columns: number): string[] => {
  const inner = columns - PANE_CHROME
  const sections = frame.sections.flatMap((s, i) => [...(i === 0 ? [] : ['']), ...boxed(['', s.title, ...s.lines.map(plain), ''], inner)])
  return boxed([plain(frame.header), '', ...sections, '', plain(frame.footer)], columns)
}
