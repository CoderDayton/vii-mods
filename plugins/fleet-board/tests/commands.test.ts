import { expect, test } from 'claude-code/testing'

import { parseCommand, runCommand } from '../src/commands'
import type { Fleet } from '../src/fleet'
import type { Peer } from '../src/peers'
import { ROLES } from '../src/roles'

test('no word opens the pane, and close closes it', () => {
  expect(parseCommand('')).toEqual({ kind: 'pane' })
  expect(parseCommand('  open ')).toEqual({ kind: 'pane' })
  expect(parseCommand('close')).toEqual({ kind: 'close' })
})

test('ping, stop and brief take a target, brief and new a role', () => {
  expect(parseCommand('ping quorum-63')).toEqual({ kind: 'ping', who: 'quorum-63' })
  expect(parseCommand('ping team')).toEqual({ kind: 'pingTeam' })
  expect(parseCommand('stop 2')).toEqual({ kind: 'stop', who: '2' })
  expect(parseCommand('brief 2 research')).toEqual({ kind: 'brief', who: '2', role: 'research' })
  expect(parseCommand('drop 2')).toEqual({ kind: 'drop', who: '2' })
  expect(parseCommand('disband')).toEqual({ kind: 'disband' })
  expect(parseCommand('list')).toEqual({ kind: 'list' })
})

test('a task is everything after the target', () => {
  expect(parseCommand('task 2 add tests for the parser')).toEqual({ kind: 'task', who: '2', text: 'add tests for the parser' })
})

test('new takes a folder, then an optional role, then an optional task', () => {
  expect(parseCommand('new /p/new research find the leak')).toEqual({ kind: 'new', dir: '/p/new', role: 'research', task: 'find the leak' })
  expect(parseCommand('new /p/new')).toEqual({ kind: 'new', dir: '/p/new', role: undefined, task: '' })
  expect(parseCommand('new /p/new fix the build')).toEqual({ kind: 'new', dir: '/p/new', role: undefined, task: 'fix the build' })
})

test('a missing or unknown word is a usage error that lists the commands', () => {
  for (const bad of ['ping', 'brief', 'brief 2', 'task 2', 'drop', 'new', 'wat']) {
    const cmd = parseCommand(bad)
    expect(cmd.kind).toBe('bad')
  }
  expect(parseCommand('brief 2 boss')).toEqual({ kind: 'bad', text: 'unknown role "boss"; use specialist, local or research' })
})

const PEERS: Peer[] = [
  { id: 'a', pid: 1, name: 'quorum-63', dir: '/p/quorum', state: 'working', startedAt: 1, updatedAt: 1000 },
  { id: 'b', pid: 2, name: 'mnemos-9e', dir: '/p/mnemos', state: 'idle', startedAt: 2, updatedAt: 1000 },
]

const stub = () => {
  const calls: string[] = []
  const ok = (text: string) => async () => (calls.push(text), { ok: true, text })
  const fleet = {
    refresh: async () => PEERS,
    ping: async (p: Peer) => (calls.push(`ping ${p.name}`), { ok: true, text: `asked ${p.name} for status` }),
    stop: async (p: Peer) => (calls.push(`stop ${p.name}`), { ok: true, text: 'stopped' }),
    task: async (p: Peer, t: string) => (calls.push(`task ${p.name} ${t}`), { ok: true, text: 'sent' }),
    brief: async (p: Peer, r: { id: string }) => (calls.push(`brief ${p.name} ${r.id}`), { ok: true, text: 'briefed' }),
    drop: async (p: Peer) => (calls.push(`drop ${p.name}`), { ok: true, text: 'dropped' }),
    pingTeam: ok('pingTeam'),
    disband: ok('disband'),
    open: async (r: { dir: string; role: { id: string }; task: string }) => (calls.push(`open ${r.dir} ${r.role.id} ${r.task}`), { ok: true, text: 'opened' }),
    team: async () => [],
  } as unknown as Fleet
  return { calls, fleet }
}

const ctx = { roster: { a: { name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1, readyAt: 2 } }, now: 1000 + 5 * 60_000, quietMs: 30 * 60_000 }

test('list prints one line per session with its number, folder, state, age and role', async () => {
  const { fleet } = stub()
  const out = await runCommand({ kind: 'list' }, fleet, ctx)
  expect(out.text.split('\n')).toEqual([
    'fleet: 2 sessions · 1 working · 1 on the team',
    '1  quorum-63  quorum  working  5m  Research',
    '2  mnemos-9e  mnemos  idle     5m  —',
  ])
})

test('a target is resolved against the live sessions before anything is sent', async () => {
  const { calls, fleet } = stub()
  expect((await runCommand({ kind: 'ping', who: 'mnemos' }, fleet, ctx)).text).toBe('asked mnemos-9e for status')
  expect((await runCommand({ kind: 'drop', who: 'mnemos' }, fleet, ctx)).text).toBe('dropped')
  expect((await runCommand({ kind: 'ping', who: 'zzz' }, fleet, ctx)).text).toBe('no running session matches "zzz"')
  expect(calls).toEqual(['ping mnemos-9e', 'drop mnemos-9e'])
})

test('brief and new use the named role, and new defaults to the specialist', async () => {
  const { calls, fleet } = stub()
  await runCommand({ kind: 'brief', who: '1', role: 'local' }, fleet, ctx)
  await runCommand({ kind: 'new', dir: '/p/new', role: undefined, task: 'go' }, fleet, ctx)
  await runCommand({ kind: 'new', dir: '/p/new', role: 'research', task: '' }, fleet, ctx)
  expect(calls).toEqual(['brief quorum-63 local', `open /p/new ${ROLES[0]!.id} go`, 'open /p/new research '])
})

test('pane and close are actions for the hook, not text', async () => {
  const { fleet } = stub()
  expect(await runCommand({ kind: 'pane' }, fleet, ctx)).toEqual({ text: '', action: 'pane' })
  expect(await runCommand({ kind: 'close' }, fleet, ctx)).toEqual({ text: '', action: 'close' })
})
