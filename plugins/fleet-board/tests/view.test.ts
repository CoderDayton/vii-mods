import { expect, test } from 'claude-code/testing'

import type { Peer } from '../src/peers'
import { headline, layoutOf, rowsOf } from '../src/view'

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
    task: '', last: '',
  })
  expect(rows[2]).toMatchObject({ n: 3, folder: 'lune-voice', state: 'idle', age: '1h', role: '—' })
})

test('a team member row carries its task id and status, and the first line of its reply', () => {
  const roster = {
    a: {
      name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2,
      task: { id: 'k3x9qa', sentAt: 5, status: 'done' as const, last: 'Built it.\ndone k3x9qa' },
    },
  }
  const rows = rowsOf(PEERS, roster, NOW, 30 * MIN)
  expect(rows[0]).toMatchObject({ task: 'task k3x9qa: done', last: 'Built it.' })
  expect(rows[1]).toMatchObject({ task: '', last: '' })
})

test('a team member that has not replied yet is marked waiting in its role', () => {
  const rows = rowsOf(PEERS, { a: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } }, NOW, 30 * MIN)
  expect(rows[0]?.role).toBe('Research · waiting')
})

test('only a working session that has not changed for the quiet time is flagged', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  expect(rows.map(r => r.isQuiet)).toEqual([false, true, false])
})

test('a wide pane puts a session on one line with a width for each column', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  expect(layoutOf(120, rows)).toEqual({ wide: true, name: 12, folder: 10, age: 5 })
})

test('a narrow pane gives the name whatever width is left, so a line never passes the pane', () => {
  const rows = rowsOf(PEERS, {}, NOW, 30 * MIN)
  const l = layoutOf(48, rows)
  expect(l.wide).toBe(false)
  expect(l.name + l.age + 15).toBe(48)
  expect(layoutOf(20, rows).name).toBe(12)
})

test('long names and folders are capped in the wide layout', () => {
  const rows = rowsOf([peer({ name: 'n'.repeat(60), dir: `/p/${'f'.repeat(60)}` })], {}, NOW, 30 * MIN)
  expect(layoutOf(200, rows)).toMatchObject({ wide: true, name: 27, folder: 18 })
})

test('the headline counts sessions, working ones and the team', () => {
  const rows = rowsOf(PEERS, { a: { name: 'quorum-63', dir: '/p/quorum', role: 'local', briefedAt: 1 } }, NOW, 30 * MIN)
  expect(headline(rows)).toBe('3 sessions · 2 working · 1 on the team')
  expect(headline(rows.slice(0, 1))).toBe('1 session · 1 working · 1 on the team')
  expect(headline([])).toBe('no other sessions')
})
