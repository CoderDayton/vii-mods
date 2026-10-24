import { expect, test } from 'claude-code/testing'

import { fmtAge, parsePeers, resolvePeer, SCAN_ARGV } from '../src/peers'
import type { Peer } from '../src/peers'

const line = (o: Record<string, unknown>) => JSON.stringify(o)

const ONE = line({
  pid: 11,
  sessionId: 'aaa',
  cwd: '/home/vii/projects/quorum',
  name: 'quorum-63',
  status: 'idle',
  startedAt: 1000,
  updatedAt: 5000,
  statusUpdatedAt: 6000,
})

const peer = (o: Partial<Peer>): Peer => ({
  id: 'x',
  pid: 1,
  name: 'x',
  dir: '/p/x',
  state: 'idle',
  startedAt: 0,
  updatedAt: 0,
  ...o,
})

test('a registry line becomes a peer, its last activity taken from statusUpdatedAt', () => {
  expect(parsePeers(ONE)).toEqual([
    { id: 'aaa', pid: 11, name: 'quorum-63', dir: '/home/vii/projects/quorum', state: 'idle', startedAt: 1000, updatedAt: 6000 },
  ])
})

test('busy is working, anything else unknown is kept as unknown', () => {
  const out = parsePeers([line({ pid: 1, sessionId: 'a', cwd: '/a', status: 'busy' }), line({ pid: 2, sessionId: 'b', cwd: '/b', status: 'weird' })].join('\n'))
  expect(out.map(p => p.state)).toEqual(['working', 'unknown'])
})

test('a missing name falls back to the folder name', () => {
  expect(parsePeers(line({ pid: 1, sessionId: 'a', cwd: '/home/vii/lune-voice' }))[0]?.name).toBe('lune-voice')
})

test('junk, blank lines and records without an id, pid or folder are skipped', () => {
  const out = parsePeers(['', 'not json', '{}', line({ pid: 1, cwd: '/a' }), line({ sessionId: 'a', cwd: '/a' }), line({ pid: 3, sessionId: 'c' }), ONE].join('\n'))
  expect(out.map(p => p.id)).toEqual(['aaa'])
})

test('the scan lists the sessions folder of the config dir and skips dead processes', () => {
  const script = SCAN_ARGV[2] ?? ''
  expect(SCAN_ARGV.slice(0, 2)).toEqual(['sh', '-c'])
  expect(script).toContain('${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions')
  expect(script).toContain('kill -0')
})

test('ages read as now, minutes, hours and days', () => {
  expect(fmtAge(0)).toBe('now')
  expect(fmtAge(59_000)).toBe('now')
  expect(fmtAge(60_000)).toBe('1m')
  expect(fmtAge(59 * 60_000)).toBe('59m')
  expect(fmtAge(60 * 60_000)).toBe('1h')
  expect(fmtAge(47 * 3_600_000)).toBe('47h')
  expect(fmtAge(48 * 3_600_000)).toBe('2d')
  expect(fmtAge(-5)).toBe('now')
})

const FLEET = [
  peer({ id: '1', name: 'quorum-63', dir: '/p/quorum' }),
  peer({ id: '2', name: 'quorum-79', dir: '/p/quorum' }),
  peer({ id: '3', name: 'mnemos-9e', dir: '/p/mnemos' }),
]

test('a target resolves by exact name, number, folder or unique prefix', () => {
  expect(resolvePeer(FLEET, 'mnemos-9e')).toEqual({ peer: FLEET[2] })
  expect(resolvePeer(FLEET, 'MNEMOS-9E')).toEqual({ peer: FLEET[2] })
  expect(resolvePeer(FLEET, '2')).toEqual({ peer: FLEET[1] })
  expect(resolvePeer(FLEET, 'mnemos')).toEqual({ peer: FLEET[2] })
  expect(resolvePeer(FLEET, 'quorum-7')).toEqual({ peer: FLEET[1] })
})

test('a session id resolves to that session even when its name is shared', () => {
  const twins = [peer({ id: 'aaa-111', name: 'twin', dir: '/p/a' }), peer({ id: 'bbb-222', name: 'twin', dir: '/p/b' })]
  expect(resolvePeer(twins, 'bbb-222')).toEqual({ peer: twins[1] })
})

test('an ambiguous or unknown target is an error that names what matched', () => {
  expect(resolvePeer(FLEET, 'quorum')).toEqual({ error: 'quorum matches several sessions: quorum-63, quorum-79' })
  expect(resolvePeer(FLEET, 'nope')).toEqual({ error: 'no running session matches "nope"' })
  expect(resolvePeer(FLEET, '9')).toEqual({ error: 'no running session matches "9"' })
  expect(resolvePeer([], 'a')).toEqual({ error: 'no other Claude session is running' })
})
