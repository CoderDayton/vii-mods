import { expect, test } from 'claude-code/testing'

import { createFleet } from '../src/fleet'
import type { Config, Hire, Io, Note } from '../src/fleet'
import type { Peer } from '../src/peers'
import { DISBAND, DROP, PING, ROLES, STOP } from '../src/roles'

type Rec = { id: string; name: string; dir: string; state?: string; at?: number }

const record = (r: Rec) =>
  JSON.stringify({
    pid: 100 + r.id.length,
    sessionId: r.id,
    cwd: r.dir,
    name: r.name,
    status: r.state ?? 'idle',
    startedAt: r.at ?? 1,
    statusUpdatedAt: r.at ?? 1,
  })

const CONFIG: Config = { launcher: 'auto', claudeArgs: '', quietMs: 30 * 60_000, waitMs: 5_000 }

const world = (config: Partial<Config> = {}) => {
  const w = {
    sessions: [
      { id: 'me', name: 'claude-mods-1c', dir: '/p/claude-mods', at: 1 },
      { id: 'q1', name: 'quorum-63', dir: '/p/quorum', at: 2 },
      { id: 'm1', name: 'mnemos-9e', dir: '/p/mnemos', at: 3 },
    ] as Rec[],
    sent: [] as Array<{ id: string; text: string }>,
    refuse: new Map<string, string>(),
    launched: [] as string[][],
    launchExit: 0,
    probe: 'ghostty\ntmux\ndisplay\n',
    dirs: new Set(['/p/new']),
    onLaunch: (() => undefined) as () => void,
    clock: 10_000,
    sleeps: 0,
    peers: [] as Peer[],
    roster: {} as Record<string, Hire>,
    notes: [] as Note[],
    boss: 'boss',
    scanExit: 0,
    store: new Map<string, unknown>(),
    replies: new Map<string, number>(),
  }
  const io: Io = {
    run: async argv => {
      const tag = argv[3]
      if (tag === 'fleet-board-scan') return { exitCode: w.scanExit, stdout: w.sessions.map(record).join('\n'), stderr: '' }
      if (tag === 'fleet-board-probe') return { exitCode: 0, stdout: w.probe, stderr: '' }
      w.launched.push([...argv])
      if (w.launchExit === 0) w.onLaunch()
      return { exitCode: w.launchExit, stdout: '', stderr: w.launchExit === 0 ? '' : 'no such terminal\nmore' }
    },
    send: async (id, text) => {
      const why = w.refuse.get(id)
      if (why !== undefined) return why
      w.sent.push({ id, text })
      return null
    },
    now: async () => w.clock,
    sleep: async () => {
      w.sleeps += 1
      w.clock += 1000
    },
    exists: async path => w.dirs.has(path),
    selfId: async () => 'me',
    reply: async peer => w.replies.get(peer.id) ?? null,
    store: {
      set: async (key, value) => void w.store.set(key, value),
      delete: async key => void w.store.delete(key),
    },
    state: {
      peers: { get: async () => w.peers, set: async fn => void (w.peers = fn(w.peers)) },
      roster: { get: async () => w.roster, set: async fn => void (w.roster = fn(w.roster)) },
      notes: { get: async () => w.notes, set: async fn => void (w.notes = fn(w.notes)) },
      boss: { get: async () => w.boss, set: async fn => void (w.boss = fn(w.boss)) },
    },
  }
  return { w, fleet: createFleet(io, { ...CONFIG, ...config }) }
}

const specialist = ROLES[0]!
const research = ROLES[2]!

test('refresh lists the other sessions in start order, leaves this one out and keeps its name', async () => {
  const { w, fleet } = world()
  const peers = await fleet.refresh()
  expect(peers.map(p => p.name)).toEqual(['quorum-63', 'mnemos-9e'])
  expect(w.peers).toEqual(peers)
  expect(w.boss).toBe('claude-mods-1c')
})

test('a session that ended drops out of the team', async () => {
  const { w, fleet } = world()
  await fleet.refresh()
  await fleet.brief(w.peers[0]!, specialist)
  w.sessions = w.sessions.filter(s => s.id !== 'q1')
  await fleet.refresh()
  expect(w.roster).toEqual({})
})

test('a ping sends the status question and notes it', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  const out = await fleet.ping(q!)
  expect(w.sent).toEqual([{ id: 'q1', text: PING }])
  expect(out).toEqual({ ok: true, text: 'asked quorum-63 for status' })
  expect(w.notes.at(-1)).toMatchObject({ ok: true, text: 'asked quorum-63 for status' })
})

test('a message that is not delivered says why and is noted as a failure', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  w.refuse.set('q1', 'the recipient is gone')
  const out = await fleet.ping(q!)
  expect(out).toEqual({ ok: false, text: 'could not reach quorum-63: the recipient is gone' })
  expect(w.notes.at(-1)?.ok).toBe(false)
})

test('briefing sends the boss briefing with the role and puts the session on the team', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  const out = await fleet.brief(q!, research)
  expect(w.sent[0]?.id).toBe('q1')
  expect(w.sent[0]?.text.startsWith("claude-mods-1c (session me), the user's boss session, is adding you to the team as Employee — Research / Investigation.")).toBe(true)
  expect(w.roster).toEqual({ q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 10_000 } })
  expect(out).toEqual({ ok: true, text: 'briefed quorum-63 as Research' })
})

test('a briefing that is not delivered leaves the team as it was', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  w.refuse.set('q1', 'offline')
  const out = await fleet.brief(q!, research)
  expect(out.ok).toBe(false)
  expect(w.roster).toEqual({})
})

test('a task goes out as one message from the boss; empty text is refused', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  expect(await fleet.task(q!, '   ')).toEqual({ ok: false, text: 'type the task first' })
  expect(w.sent).toEqual([])
  const out = await fleet.task(q!, 'Add tests for the parser.')
  expect(w.sent).toEqual([{ id: 'q1', text: 'Task from claude-mods-1c: Add tests for the parser.' }])
  expect(out).toEqual({ ok: true, text: 'sent quorum-63 a task' })
})

test('stop asks the session to stop its run and wait', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  expect(await fleet.stop(q!)).toEqual({ ok: true, text: 'told quorum-63 to stop its run' })
  expect(w.sent).toEqual([{ id: 'q1', text: STOP }])
})

test('ping team asks only the sessions on the team', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  expect(await fleet.pingTeam()).toEqual({ ok: false, text: 'nobody is on the team yet; brief a session first' })
  await fleet.brief(q!, specialist)
  w.sent.length = 0
  const out = await fleet.pingTeam()
  expect(w.sent).toEqual([{ id: 'q1', text: PING }])
  expect(out).toEqual({ ok: true, text: 'asked 1 session for status' })
})

test('disband tells the team and clears it', async () => {
  const { w, fleet } = world()
  const peers = await fleet.refresh()
  await fleet.brief(peers[0]!, specialist)
  await fleet.brief(peers[1]!, research)
  w.sent.length = 0
  const out = await fleet.disband()
  expect(w.sent.map(s => s.text)).toEqual([DISBAND, DISBAND])
  expect(w.roster).toEqual({})
  expect(out).toEqual({ ok: true, text: 'disbanded the team of 2' })
  expect(await fleet.disband()).toEqual({ ok: false, text: 'nobody is on the team' })
})

test('the notes keep the last six', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  for (let i = 0; i < 9; i++) await fleet.ping(q!)
  expect(w.notes.length).toBe(6)
})

const comesUp = (w: ReturnType<typeof world>['w'], dir: string) => () => {
  w.sessions.push({ id: 'n1', name: 'new-1', dir, at: w.clock + 500 })
}

test('opening a session starts claude in the folder, waits for it, briefs it and gives it the task', async () => {
  const { w, fleet } = world()
  w.onLaunch = comesUp(w, '/p/new')
  const out = await fleet.open({ dir: '/p/new', role: research, task: 'Find the leak.' })
  expect(w.launched).toEqual([['setsid', '-f', 'ghostty', '--working-directory=/p/new', '-e', 'claude']])
  expect(w.sent.map(s => s.id)).toEqual(['n1', 'n1'])
  expect(w.sent[0]?.text).toContain('Employee — Research / Investigation')
  expect(w.sent[1]?.text).toBe('Task from claude-mods-1c: Find the leak.')
  expect(w.roster['n1']?.role).toBe('research')
  expect(out).toEqual({ ok: true, text: 'opened new-1 in a ghostty window as Research' })
})

test('without a task only the briefing goes out; the extra arguments reach claude', async () => {
  const { w, fleet } = world({ claudeArgs: '--model opus' })
  w.onLaunch = comesUp(w, '/p/new')
  await fleet.open({ dir: '/p/new', role: specialist, task: '' })
  expect(w.sent.length).toBe(1)
  expect(w.launched[0]).toEqual(['setsid', '-f', 'ghostty', '--working-directory=/p/new', '-e', 'claude', '--model', 'opus'])
})

test('a background tmux session says how to look at it', async () => {
  const { w, fleet } = world({ launcher: 'tmux' })
  w.onLaunch = comesUp(w, '/p/new')
  const out = await fleet.open({ dir: '/p/new', role: research, task: '' })
  const tag = w.launched[0]?.[4] ?? ''
  expect(tag.startsWith('fleet-new-')).toBe(true)
  expect(out).toEqual({ ok: true, text: `opened new-1 in a background tmux session as Research; see it with: tmux attach -t ${tag}` })
})

test('a folder must be absolute and exist', async () => {
  const { w, fleet } = world()
  expect(await fleet.open({ dir: 'relative', role: research, task: '' })).toEqual({ ok: false, text: 'the folder must be an absolute path' })
  expect(await fleet.open({ dir: '/p/missing', role: research, task: '' })).toEqual({ ok: false, text: '/p/missing is not a folder' })
  expect(w.launched).toEqual([])
})

test('with no terminal or tmux nothing is started', async () => {
  const { w, fleet } = world()
  w.probe = ''
  const out = await fleet.open({ dir: '/p/new', role: research, task: '' })
  expect(out).toEqual({ ok: false, text: 'no terminal window or tmux found to open a session in (launcher: auto)' })
  expect(w.launched).toEqual([])
})

test('a launcher that fails is reported with its first error line', async () => {
  const { w, fleet } = world()
  w.launchExit = 1
  expect(await fleet.open({ dir: '/p/new', role: research, task: '' })).toEqual({ ok: false, text: 'could not start ghostty: no such terminal' })
})

test('a session that never shows up is reported after the wait, without a briefing', async () => {
  const { w, fleet } = world()
  const out = await fleet.open({ dir: '/p/new', role: research, task: '' })
  expect(out.ok).toBe(false)
  expect(out.text).toContain('has not appeared')
  expect(w.sent).toEqual([])
  expect(w.sleeps).toBe(5)
})

test('a session that was already running in the folder is not mistaken for the new one', async () => {
  const { w, fleet } = world()
  w.sessions.push({ id: 'old', name: 'old-one', dir: '/p/new', at: 4 })
  const out = await fleet.open({ dir: '/p/new', role: research, task: '' })
  expect(out.ok).toBe(false)
  expect(w.sent).toEqual([])
})

test('briefing records the boss and the role under the employee, for the employee to read', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  expect(w.store.get('hire:q1')).toEqual({ bossId: 'me', bossName: 'claude-mods-1c', role: 'research' })
})

test('a session that ended loses its hire record too', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  w.sessions = w.sessions.filter(s => s.id !== 'q1')
  await fleet.refresh()
  expect(w.store.has('hire:q1')).toBe(false)
})

test('a failed session scan keeps the team as it was', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  w.scanExit = 1
  await fleet.refresh()
  expect(w.roster).toEqual({ q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 10_000 } })
  expect(w.store.has('hire:q1')).toBe(true)
})

test('drop tells a team member it is off the team and removes it from the team', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  w.sent.length = 0
  const out = await fleet.drop(q!)
  expect(w.sent).toEqual([{ id: 'q1', text: DROP }])
  expect(w.roster).toEqual({})
  expect(w.store.has('hire:q1')).toBe(false)
  expect(out).toEqual({ ok: true, text: 'dropped quorum-63 from the team' })
})

test('drop of a session that is not on the team is refused and sends nothing', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  expect(await fleet.drop(q!)).toEqual({ ok: false, text: 'quorum-63 is not on the team' })
  expect(w.sent).toEqual([])
})

test('drop of an unreachable member still removes it, and says it could not tell it', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  w.refuse.set('q1', 'gone')
  const out = await fleet.drop(q!)
  expect(w.roster).toEqual({})
  expect(w.store.has('hire:q1')).toBe(false)
  expect(out).toEqual({ ok: false, text: 'dropped quorum-63 from the team, but could not tell it: gone' })
})

test('disband names the members it could not reach, and still clears the team and its hire records', async () => {
  const { w, fleet } = world()
  const peers = await fleet.refresh()
  await fleet.brief(peers[0]!, specialist)
  await fleet.brief(peers[1]!, research)
  w.refuse.set('m1', 'gone')
  const out = await fleet.disband()
  expect(w.roster).toEqual({})
  expect(w.store.size).toBe(0)
  expect(out).toEqual({ ok: false, text: 'disbanded the team of 2; could not reach mnemos-9e' })
})

test('a refresh marks a briefed session ready once its transcript shows a reply', async () => {
  const { w, fleet } = world()
  const [q] = await fleet.refresh()
  await fleet.brief(q!, research)
  expect(w.roster.q1?.readyAt).toBeUndefined()
  w.replies.set('q1', 20_000)
  await fleet.refresh()
  expect(w.roster.q1).toEqual({ name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 10_000, readyAt: 20_000 })
})

test('a session that has not replied stays waiting, and a team member that is gone is not asked', async () => {
  const { w, fleet } = world()
  const peers = await fleet.refresh()
  await fleet.brief(peers[0]!, research)
  await fleet.refresh()
  expect(w.roster.q1?.readyAt).toBeUndefined()
  w.sessions = w.sessions.filter(s => s.id !== 'q1')
  w.replies.set('q1', 20_000)
  await fleet.refresh()
  expect(w.roster).toEqual({})
})
