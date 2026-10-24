import { expect, test } from 'claude-code/testing'

import type { Peer } from '../src/peers'
import { bodyColumns, frameOf, headline, rowsOf, textOf, wrap } from '../src/view'
import type { Row } from '../src/view'
import type { Task } from '../types'

const MIN = 60_000

const peer = (o: Partial<Peer>): Peer => ({ id: 'x', pid: 1, name: 'x', dir: '/p/x', state: 'idle', startedAt: 0, updatedAt: 0, ...o })

const NOW = 100 * MIN

const PEERS = [
  peer({ id: 'a', name: 'quorum-63', dir: '/p/quorum', state: 'working', updatedAt: NOW - 2 * MIN }),
  peer({ id: 'b', name: 'mnemos-9e', dir: '/p/mnemos', state: 'working', updatedAt: NOW - 48 * MIN }),
  peer({ id: 'c', name: 'lune', dir: '/p/lune-voice', state: 'idle', updatedAt: NOW - 90 * MIN }),
]

test('a row has its number, names, state, age and role', () => {
  const rows = rowsOf(PEERS, { a: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1, readyAt: 2 } }, NOW, 30 * MIN)
  expect(rows[0]).toEqual({
    n: 1, id: 'a', name: 'quorum-63', folder: 'quorum', state: 'working', age: '2m', isQuiet: false, role: 'Research',
    waiting: false, taskId: '', status: '', flag: '', last: '', taskAge: '', queued: 0,
  })
  expect(rows[2]).toMatchObject({ n: 3, folder: 'lune-voice', state: 'idle', age: '1h', role: '—' })
})

test('a team member row carries its task id, status and the whole reply', () => {
  const roster = {
    a: {
      name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2,
      task: { id: 'k3x9qa', sentAt: 5, status: 'done' as const, last: 'Built it.\ndone k3x9qa' },
    },
  }
  const rows = rowsOf(PEERS, roster, NOW, 30 * MIN)
  expect(rows[0]).toMatchObject({ taskId: 'k3x9qa', status: 'done', flag: '', last: 'Built it.\ndone k3x9qa' })
  expect(rows[1]).toMatchObject({ taskId: '', status: '', last: '' })
})

test('a sent task is flagged asked on a question and stale after ten quiet minutes', () => {
  const hire = (task: Task) => ({ name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2, task })
  const asked = rowsOf(PEERS, { a: hire({ id: 'k3x9qa', sentAt: NOW - MIN, status: 'sent', last: 'Which parser module?', lastAt: NOW - MIN }) }, NOW, 30 * MIN)
  expect(asked[0]).toMatchObject({ status: 'sent', flag: 'asked' })
  const stale = rowsOf(PEERS, { a: hire({ id: 'k3x9qa', sentAt: NOW - 20 * MIN, status: 'sent', last: 'working', lastAt: NOW - 11 * MIN }) }, NOW, 30 * MIN)
  expect(stale[0]).toMatchObject({ status: 'sent', flag: 'stale' })
  const fresh = rowsOf(PEERS, { a: hire({ id: 'k3x9qa', sentAt: NOW - 20 * MIN, status: 'sent', last: 'working', lastAt: NOW - 9 * MIN }) }, NOW, 30 * MIN)
  expect(fresh[0]).toMatchObject({ status: 'sent', flag: '' })
})

test('a row carries how long its sent task has run and how many tasks wait in its queue', () => {
  const hire = {
    name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2,
    task: { id: 'k3x9qa', sentAt: NOW - 12 * MIN, status: 'sent' as const },
    queue: [{ id: 'b2b2b2', text: 'Next.', queuedAt: 1 }],
  }
  expect(rowsOf(PEERS, { a: hire }, NOW, 30 * MIN)[0]).toMatchObject({ taskAge: '12m', queued: 1 })
  const done = { ...hire, task: { ...hire.task, status: 'done' as const } }
  expect(rowsOf(PEERS, { a: done }, NOW, 30 * MIN)[0]).toMatchObject({ taskAge: '', queued: 1 })
})

test('a team member that has not replied yet is marked waiting', () => {
  const rows = rowsOf(PEERS, { a: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } }, NOW, 30 * MIN)
  expect(rows[0]).toMatchObject({ role: 'Research', waiting: true })
})

test('only a working session that has not changed for the quiet time is flagged', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  expect(rows.map(r => r.isQuiet)).toEqual([false, true, false])
})

test('the headline counts sessions, working ones and the team', () => {
  const rows = rowsOf(PEERS, { a: { name: 'quorum-63', dir: '/p/quorum', role: 'local', briefedAt: 1 } }, NOW, 30 * MIN)
  expect(headline(rows)).toBe('3 sessions  2 working  1 on team')
  expect(headline(rows.slice(0, 1))).toBe('1 session  1 working  1 on team')
  expect(headline([])).toBe('no other sessions')
})

test('the body is the pane width less the pane border and padding and the section border and padding', () => {
  expect(bodyColumns(80)).toBe(72)
  expect(bodyColumns(60)).toBe(52)
  expect(bodyColumns(10)).toBe(20)
})

// A team of four with every kind of line, and a session with a long name and folder.
const busyRows = (): Row[] => {
  const peers = [
    peer({ id: 'a', name: 'quorum-63', dir: '/p/quorum', state: 'working', updatedAt: NOW - 2 * MIN }),
    peer({ id: 'b', name: 'mnemos-9e', dir: '/p/mnemos', state: 'working', updatedAt: NOW - 48 * MIN }),
    peer({ id: 'c', name: 'lune', dir: '/p/lune-voice', state: 'idle', updatedAt: NOW - 90 * MIN }),
    peer({ id: 'd', name: 'orchard-1f', dir: '/p/orchard', state: 'working', updatedAt: NOW - MIN }),
    peer({ id: 'e', name: 'n'.repeat(40), dir: `/p/${'f'.repeat(40)}`, state: 'idle', updatedAt: NOW - 5 * MIN }),
    peer({ id: 'f', name: 'other-2a', dir: '/p/other', state: 'idle', updatedAt: NOW - 5 * MIN }),
  ]
  const base = { dir: '/p/x', role: 'research' as const, briefedAt: 1, readyAt: 2 }
  const roster = {
    a: { ...base, name: 'quorum-63', task: { id: 'k3x9qa', sentAt: 5, status: 'done' as const, last: `Built the parser and its tests, all green. ${'More detail. '.repeat(20)}\ndone k3x9qa` } },
    b: { ...base, name: 'mnemos-9e', task: { id: 'm4p2zz', sentAt: 5, status: 'blocked' as const, blocker: 'blocked m4p2zz: no parser', last: 'blocked m4p2zz: no parser' } },
    c: { ...base, name: 'lune', task: { id: 'p7q1ab', sentAt: NOW - MIN, status: 'sent' as const, last: 'Which parser module?', lastAt: NOW - MIN } },
    d: { ...base, name: 'orchard-1f', task: { id: 'r2s8cd', sentAt: NOW - 30 * MIN, status: 'sent' as const, last: 'working on it', lastAt: NOW - 20 * MIN } },
  }
  return rowsOf(peers, roster, NOW, 30 * MIN)
}

const NOTES = [
  { ok: true, text: 'sent quorum-63 a task', at: 1 },
  { ok: false, text: `could not reach mnemos-9e: ${'the session api broke '.repeat(8)}`, at: 2 },
]

for (const columns of [60, 80, 120]) {
  test(`at ${columns} columns no line is wider than the pane, and the frame has a border, status words and plain characters only`, () => {
    const lines = textOf(frameOf(busyRows(), NOTES, columns), columns)
    expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(columns)
    expect(lines[0]?.startsWith('╭') && lines[0]?.endsWith('╮')).toBe(true)
    expect(lines.at(-1)?.startsWith('╰') && lines.at(-1)?.endsWith('╯')).toBe(true)
    for (const line of lines.slice(1, -1)) expect(line.startsWith('│') && line.endsWith('│')).toBe(true)
    const text = lines.join('\n')
    for (const word of ['fleet', 'done', 'blocked', 'asked', 'stale', 'working', 'idle', 'esc closes', '[ refresh ]', '[ close ]', 'activity']) {
      expect(text).toContain(word)
    }
    expect(/[^\x20-\x7e─│╭╮╰╯…\n]/.test(text)).toBe(false)
  })
}

test('wrap breaks on spaces, keeps blank lines, and hard-breaks a word longer than the width', () => {
  expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrap('a\n\nb', 10)).toEqual(['a', '', 'b'])
  expect(wrap('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'xxxxx'])
})

// The lines of a team member's reply: those indented under the status column.
const replyLines = (lines: string[]): string[] => lines.filter(l => /^│ │ {9}\S/.test(l) || /^│ │ {9}$/.test(l))

for (const columns of [60, 80, 120]) {
  test(`at ${columns} columns a long reply is word-wrapped whole under its status word`, () => {
    const lines = textOf(frameOf(busyRows(), [], columns), columns)
    expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(columns)
    const reply = replyLines(lines)
      .map(l => l.replace(/^│ │ +/, '').replace(/ *│ │$/, ''))
      .join(' ')
    const first = reply.slice(0, reply.indexOf('done k3x9qa') + 'done k3x9qa'.length)
    const expected = `Built the parser and its tests, all green. ${'More detail. '.repeat(20)}done k3x9qa`.split(/\s+/).join(' ')
    expect(first).toBe(expected)
    expect(replyLines(lines).join('')).not.toContain('…')
  })
}

test('a reply of 30 lines shows 12 and then how many more', () => {
  const reply = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
  const rows = rowsOf(PEERS.slice(0, 1), { a: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1, readyAt: 2, task: { id: 'k3x9qa', sentAt: 5, status: 'done', last: reply } } }, NOW, 30 * MIN)
  const text = textOf(frameOf(rows, [], 80), 80).join('\n')
  expect(text).toContain('line 12 ')
  expect(text).not.toContain('line 13 ')
  expect(text).toContain('... 18 more lines')
})

test('an activity entry is word-wrapped up to 2 lines, then how many more', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  const long = Array.from({ length: 10 }, (_, i) => `part${i + 1}`).join('\n')
  const lines = textOf(frameOf(rows, [{ ok: true, text: long, at: NOW }], 60, { now: NOW }), 60)
  expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(60)
  const text = lines.join('\n')
  expect(text).toContain('part2')
  expect(text).not.toContain('part3')
  expect(text).toContain('... 8 more lines')
})

test('activity lists the newest entry first, each with its age, and a failure in red', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  const notes = [
    { ok: true, text: 'quorum-63: task k3x9qa is done.', at: NOW - 5 * MIN },
    { ok: false, text: 'could not reach mnemos-9e: gone', at: NOW - 30_000 },
  ]
  const activity = frameOf(rows, notes, 80, { now: NOW }).sections.find(s => s.title === 'activity')
  const plainLines = activity?.lines.map(l => l.map(s => s.text).join('').trimEnd())
  expect(plainLines).toEqual(['now  could not reach mnemos-9e: gone', '5m   quorum-63: task k3x9qa is done.'])
  expect(activity?.lines[0]?.at(-1)?.tone).toBe('error')
})

test('blocked, asked and stale lines start with their accent word, and done is green', () => {
  const { sections } = frameOf(busyRows(), [], 80)
  const team = sections.find(s => s.title === 'team')
  const first = (word: string) => team?.lines.find(l => l[0]?.text.trim() === word)?.[0]
  expect(first('blocked')?.tone).toBe('error')
  expect(first('asked')?.tone).toBe('warning')
  expect(first('stale')?.tone).toBe('warning')
  expect(first('done')?.tone).toBe('success')
})

test('the team section is left out when nobody is on the team, and activity only when there is some', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  const titles = frameOf(rows, [], 80).sections.map(s => s.title)
  expect(titles).toEqual(['other sessions'])
  expect(frameOf(rows, NOTES, 80).sections.map(s => s.title)).toEqual(['other sessions', 'activity'])
})

test('the first line of each team member is pressable, keyed by its session id', () => {
  const team = frameOf(busyRows(), [], 80).sections.find(s => s.title === 'team')
  expect(Object.values(team?.press ?? {})).toEqual(['a', 'b', 'c', 'd'])
  for (const [at, id] of Object.entries(team?.press ?? {})) {
    expect(team?.lines[Number(at)]?.map(s => s.text).join('')).toContain(busyRows().find(r => r.id === id)?.name ?? '?')
  }
})

const DETAIL_HIRE = {
  name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2,
  task: {
    id: 'k3x9qa', sentAt: NOW - 12 * MIN, status: 'sent' as const, text: `Build the parser. ${'Every rule. '.repeat(12)}`,
    scope: 'src/parser only', done: 'the tests pass', last: 'Which lexer?', lastAt: NOW - MIN,
  },
  queue: [{ id: 'b2b2b2', text: 'Review it.', after: 'zz9zz9', queuedAt: 1 }],
  history: [{ id: 'a1a1a1', sentAt: 0, status: 'done' as const, text: 'Set up.', endedAt: 4 * MIN }],
}

for (const columns of [60, 80, 120]) {
  test(`at ${columns} columns a member's detail shows its brief, reply, queue and earlier tasks, and a back button`, () => {
    const rows = rowsOf(PEERS, { a: DETAIL_HIRE }, NOW, 30 * MIN)
    const frame = frameOf(rows, NOTES, columns, { detail: { row: rows[0]!, hire: DETAIL_HIRE, now: NOW } })
    expect(frame.sections.map(s => s.title)).toEqual(['quorum-63'])
    const lines = textOf(frame, columns)
    expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(columns)
    const text = lines.join('\n')
    for (const word of ['Research', 'working', 'k3x9qa', 'sent', '12m', 'Build the parser.', 'src/parser only', 'the tests pass', 'Which lexer?', 'b2b2b2', 'after zz9zz9', 'Review it.', 'a1a1a1', 'done in 4m', '[ back ]']) {
      expect(text).toContain(word)
    }
    expect(text.replace(/[│ \n]+/g, ' ')).toContain(`Build the parser. ${'Every rule. '.repeat(12)}`.trim())
    expect(text).not.toContain('mnemos-9e')
  })
}

test('with no other sessions the header says so, and there is no empty sessions box', () => {
  expect(frameOf([], [], 80).sections).toEqual([])
  const text = textOf(frameOf([], [], 80), 80).join('\n')
  expect(text).toContain('no other sessions')
  expect(text).not.toContain('team')
})

test('the sessions table has aligned columns: name, state, quiet time and folder', () => {
  const lines = textOf(frameOf(rowsOf(PEERS, {}, NOW, 30 * MIN), [], 80), 80)
  const header = lines.find(l => l.includes('name') && l.includes('state'))
  expect(header).toBeDefined()
  const col = (l: string | undefined, word: string) => l?.indexOf(word) ?? -1
  const a = lines.find(l => l.includes('quorum-63'))
  const b = lines.find(l => l.includes('mnemos-9e'))
  expect(col(a, 'working')).toBe(col(b, 'working'))
  expect(col(header, 'state')).toBe(col(a, 'working'))
  expect(col(header, 'folder')).toBe(col(lines.find(l => l.includes('lune-voice')), 'lune-voice'))
  expect(col(header, 'quiet')).toBe(col(a, '2m'))
})
