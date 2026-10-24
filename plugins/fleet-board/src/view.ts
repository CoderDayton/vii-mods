import { baseName, fmtAge } from './peers'
import type { Peer, PeerState } from './peers'
import { roleOf, ROLES } from './roles'
import type { Hire, Note } from './fleet'
import { endedIn, quietSince, STALE_MS } from './team'
import { isQuestion, lineOf } from './transcript'
import type { PooledTask, Task, TaskStatus } from '../types'

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
  taskAge: string
  queued: number
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
      taskAge: hire?.task?.status === 'sent' ? fmtAge(now - hire.task.sentAt) : '',
      queued: hire?.queue?.length ?? 0,
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
export type Section = { title: string; lines: Line[]; press?: Record<number, string>; pressKey?: string }
export type Action = { key: string; label: string }
export type Frame = { header: Line; sections: Section[]; footer: Line; back: boolean; actions: Action[] }

export type Detail = { row: Row; hire?: Hire; now: number }

const actionsOf = (hire: Hire | undefined): Action[] =>
  hire === undefined
    ? ROLES.map(r => ({ key: `hire:${r.id}`, label: `hire as ${r.label}` }))
    : [...ROLES.filter(r => r.id !== hire.role).map(r => ({ key: `role:${r.id}`, label: `make ${r.label}` })), { key: 'fire', label: 'fire' }]

// The Button labels. The terminal draws "[ label ]" around a label itself, so the labels carry no brackets and the
// plain-text frame adds the one pair.
export const REFRESH_LABEL = 'refresh'
export const CLOSE_LABEL = 'close'
export const BACK_LABEL = 'back'

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

const wordTone: Record<string, Tone> = { done: 'success', blocked: 'error', asked: 'warning', stale: 'warning', sent: 'plain', cancelled: 'dim' }

// A team member: the state word first, then the name, role and task id, with the first line of its reply under it.
const memberLines = (r: Row, width: number): Line[] => {
  const word = r.flag !== '' ? r.flag : r.status !== '' ? r.status : 'no task'
  const head: Line = [
    seg(word.padEnd(WORD), wordTone[word] ?? 'dim'),
    seg(r.name, 'bold'),
    seg(
      `  ${r.role}, ${r.waiting ? 'waiting' : 'ready'}, ${r.state}${r.taskId === '' ? '' : `  task ${r.taskId}`}${r.taskAge === '' ? '' : ` ${r.taskAge}`}${r.queued === 0 ? '' : `  ${r.queued} queued`}`,
      'dim',
    ),
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

const LABEL = 11

const field = (label: string, text: string, width: number, cap = REPLY_LINES): Line[] =>
  capped(wrap(text, width - LABEL), cap).map((line, i) => [seg((i === 0 ? label : '').padEnd(LABEL), 'dim'), seg(line)])

const detailLines = ({ row, hire, now }: Detail, width: number): Line[] => {
  if (hire === undefined) return [...field('state', `${row.state}, not on the team`, width), ...field('folder', row.folder, width)]
  const task = hire.task
  const state = field('state', `${row.role}, ${row.waiting ? 'waiting' : 'ready'}, ${row.state}`, width)
  if (task === undefined) return [...state, ...field('task', 'none', width), ...queueFields(hire, width)]
  return [
    ...state,
    [
      seg('task'.padEnd(LABEL), 'dim'),
      seg(task.id),
      seg(`  ${task.status}`, wordTone[task.status] ?? 'plain'),
      seg(row.flag === '' ? '' : `  ${row.flag}`, wordTone[row.flag] ?? 'plain'),
      seg(task.status === 'sent' ? `  ${fmtAge(now - task.sentAt)}` : '', 'dim'),
    ],
    ...(task.text === undefined ? [] : field('goal', task.text, width)),
    ...(task.scope === undefined ? [] : field('scope', task.scope, width)),
    ...(task.done === undefined ? [] : field('done when', task.done, width)),
    ...(task.last === undefined ? [] : field('reply', task.last, width)),
    ...queueFields(hire, width),
  ].map(line => fit(line, width))
}

const queueFields = (hire: Hire, width: number): Line[] => [
  ...(hire.queue ?? []).flatMap((q, i) =>
    field(i === 0 ? 'queued' : '', `${q.id}${q.after === undefined ? '' : ` after ${q.after}`}: ${q.text}`, width, NOTE_LINES),
  ),
  ...(hire.history ?? []).flatMap((t, i) =>
    field(i === 0 ? 'earlier' : '', `${t.id} ${endedIn(t)}${t.text === undefined ? '' : `: ${t.text}`}`, width, NOTE_LINES),
  ),
]

const AGE_W = 5
const ACTIVITY_LINES = 2

const activityLines = (n: Note, width: number, now: number): Line[] =>
  capped(wrap(n.text, width - AGE_W), ACTIVITY_LINES).map((text, i) => [
    seg((i === 0 ? fmtAge(now - n.at) : '').padEnd(AGE_W), 'dim'),
    seg(text, n.ok ? 'plain' : 'error'),
  ])

const teamSection = (team: readonly Row[], width: number): Section => {
  const lines: Line[] = []
  const press: Record<number, string> = {}
  for (const r of team) {
    if (lines.length > 0) lines.push([])
    press[lines.length] = r.id
    lines.push(...memberLines(r, width))
  }
  return { title: 'team', lines, press }
}

const poolSection = (pool: readonly PooledTask[], width: number): Section => ({
  title: 'unassigned',
  lines: pool.flatMap(p =>
    field(p.id, `for ${roleOf(p.role)?.label ?? p.role}${p.after === undefined ? '' : ` after ${p.after}`}: ${p.text}`, width, NOTE_LINES),
  ),
})

export const frameOf = (
  rows: readonly Row[],
  notes: readonly Note[],
  columns: number,
  view: { detail?: Detail; pool?: readonly PooledTask[]; now?: number } = {},
): Frame => {
  const width = bodyColumns(columns)
  const edge = Math.max(MIN_BODY, columns - PANE_CHROME)
  const header = fit([seg('fleet', 'bold'), seg(`  ${headline(rows)}`, 'dim')], edge)
  const buttons = `[ ${REFRESH_LABEL} ]  [ ${CLOSE_LABEL} ]  `
  if (view.detail !== undefined) {
    return {
      header,
      sections: [{ title: view.detail.row.name, lines: detailLines(view.detail, width) }],
      footer: fit([seg(`[ ${BACK_LABEL} ]  ${buttons}`), seg('esc closes', 'dim')], edge),
      back: true,
      actions: actionsOf(view.detail.hire),
    }
  }
  const team = rows.filter(r => r.role !== '—')
  const others = rows.filter(r => r.role === '—')
  const sections: Section[] = []
  if (team.length > 0) sections.push(teamSection(team, width))
  if (view.pool !== undefined && view.pool.length > 0) sections.push(poolSection(view.pool, width))
  const otherPress = Object.fromEntries(others.map((r, i) => [i + 1, r.id]))
  if (others.length > 0) sections.push({ title: 'other sessions', lines: tableLines(others, width), press: otherPress, pressKey: 'session' })
  const now = view.now ?? Math.max(0, ...notes.map(n => n.at))
  if (notes.length > 0) sections.push({ title: 'activity', lines: [...notes].reverse().flatMap(n => activityLines(n, width, now)) })
  return { header, sections, footer: fit([seg(buttons), seg('esc closes', 'dim')], edge), back: false, actions: [] }
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
