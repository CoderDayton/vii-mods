import { expect, mock, test } from 'claude-code/testing'

const LIVE = { cwd: '/p/claude-mods', surface: 'terminal' as const, isInteractive: true }
const PANE = 'fleet'
const NOW = 10_000_000

type Rec = { id: string; name: string; dir: string; state?: string; at: number; updated?: number }

const record = (r: Rec) =>
  JSON.stringify({
    pid: 100 + r.at,
    sessionId: r.id,
    cwd: r.dir,
    name: r.name,
    status: r.state ?? 'idle',
    startedAt: r.at,
    statusUpdatedAt: r.updated ?? NOW - 120_000,
  })

const world = (on: Parameters<typeof mock.clock>[0], seed: Record<string, unknown> = {}) => {
  mock.store(on, seed)
  const w = {
    clock: mock.clock(on, { now: NOW }),
    sessions: [
      { id: 'me', name: 'claude-mods-1c', dir: '/p', at: 1 },
      { id: 'q1', name: 'quorum-63', dir: '/p/quorum', state: 'busy', at: 2 },
      { id: 'm1', name: 'mnemos-9e', dir: '/p/mnemos', state: 'busy', at: 3, updated: NOW - 3_600_000 },
    ] as Rec[],
    sent: [] as Array<{ to: unknown; text: string }>,
    commands: [] as string[],
    opened: [] as Array<{ id: string; title?: string }>,
    toasts: [] as string[],
    panes: [] as string[],
    statuses: [] as Array<string | undefined>,
    refuse: false,
    transcripts: {} as Record<string, string>,
    transcriptReads: 0,
    scans: 0,
    transcriptBytes: 0,
  }
  const ran = (stdout: string, exitCode = 0) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me' }))
  on('session.root', () => ({ value: '/p/claude-mods' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }) as never)
  on('fs.list', () => ({
    value: [
      { name: 'new', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: '.hidden', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
    ],
  }) as never)
  on('process.run', (_$, e) => {
    const tag = e.argv[3]
    if (tag === 'fleet-board-scan') {
      w.scans += 1
      return ran(w.sessions.map(record).join('\n'))
    }
    if (tag === 'fleet-board-size' || tag === 'fleet-board-read') {
      w.transcriptReads += 1
      const bytes = new TextEncoder().encode(w.transcripts[e.argv[5] ?? ''] ?? '')
      const out = tag === 'fleet-board-size' ? new TextEncoder().encode(String(bytes.length)) : bytes.slice(Number(e.argv[6]))
      w.transcriptBytes += out.length
      return ran(new TextDecoder().decode(out))
    }
    return ran('')
  })
  on('session.send', (_$, e) => {
    if (w.refuse) return { isDelivered: false, reason: 'gone' } as never
    w.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: undefined } as never
  })
  on('ui.open', (_$, e) => {
    w.opened.push({ id: e.id, title: e.title })
    w.panes.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    w.panes = w.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id })) }) as never)
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  return w
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

const slash = (args: string) => ({ command: 'fleet', args }) as never
const run = async ($: Engine, args: string) => ((await $.command.run(slash(args))) as { text: string }).text

// Calls one of the boss's fleet tools the way the model does. The engine takes the output as a string, an array or
// undefined, and an error is marked isError; the text and the flag are read from that shape.
const tool = async ($: Engine, name: string, input: Record<string, unknown> = {}) => {
  const out = (await $.tool.call({ tool: `mcp__fleet-board__${name}`, ...input } as never)) as {
    result?: unknown
    isError?: boolean
  }
  expect(typeof out.result === 'string' || Array.isArray(out.result) || out.result === undefined).toBe(true)
  return { text: typeof out.result === 'string' ? out.result : '', isError: out.isError === true }
}

const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'fleet-board', surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })

const TEAM = { 'team:me': { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } } }

const DONE_TEAM = {
  'team:me': {
    q1: {
      name: 'quorum-63',
      dir: '/p/quorum',
      role: 'research',
      briefedAt: 1,
      readyAt: 2,
      task: { id: 'k3x9qa', sentAt: 5, status: 'done', last: 'Built it.\ndone k3x9qa', announced: 'done' },
    },
  },
}

test('the /fleet command is registered', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.commands).toEqual(['fleet'])
})

test('/fleet opens the pane, and close closes it', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  expect(w.opened).toEqual([{ id: PANE, title: 'Fleet' }])
  await run($, 'close')
  expect(w.panes).toEqual([])
})

test('/fleet has no other subcommands, so it sends nothing and changes no team', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  for (const args of ['list', 'ping team', 'brief 1 research', 'task 1 go', 'drop 1', 'disband', 'new /p/new']) {
    expect(await run($, args)).toMatch(/^usage: /)
  }
  expect(w.sent).toEqual([])
  expect(w.opened).toEqual([])
})

test('the pane shows each session with its flags', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /2 sessions {2}2 working/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /quorum-63/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /mnemos-9e/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /esc closes/ })).toBeDefined()
  await ui.unmount()
})

test('the pane has no write actions: no input, no select, and only Refresh, Close and a row per member as buttons', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  for (const action of [/Ping/, /Hire/, /Stop/, /Drop/, /Disband/, /New session/, /Open/, /Cancel/]) {
    expect(await ui.find({ type: 'Button', text: action })).toBeUndefined()
  }
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['member:q1', 'refresh', 'close'])
  expect(await ui.find({ type: 'Button', text: /^refresh$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^close$/ })).toBeDefined()
  const sent = w.sent.length
  await ui.press({ key: 'member:q1' })
  expect(w.sent.length).toBe(sent)
  // The terminal draws "[ label ]" around a Button label, so a label with brackets of its own would show two pairs.
  expect(await ui.find({ type: 'Button', text: /[\[\]]/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane shows a team member with its task id, status and reply', async ($, on) => {
  world(on, DONE_TEAM)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /^team$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /task k3x9qa/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Built it\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^done/ })).toBeDefined()
  await ui.unmount()
})

test('fleet_hire briefs the session for its role and puts it on the team', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  const out = await tool($, 'fleet_hire', { session: 'quorum', role: 'research' })
  expect(out).toEqual({ text: 'briefed quorum-63 as Research', isError: false })
  expect(JSON.stringify(w.sent[0]?.to)).toContain('q1')
  expect(w.sent[0]?.text).toContain('Employee — Research / Investigation')
  expect((await tool($, 'fleet_status')).text).toContain('quorum-63 (session q1): Research, waiting for a reply')
})

test('fleet_hire of a session already on the team is an error and changes nothing', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  const sent = w.sent.length
  expect(await tool($, 'fleet_hire', { session: 'quorum', role: 'local' })).toEqual({
    text: 'quorum-63 is already on the team; fleet_drop it first',
    isError: true,
  })
  expect(w.sent.length).toBe(sent)
  expect((await tool($, 'fleet_status')).text).toContain('quorum-63 (session q1): Research')
})

const OTHER_BOSS = { id: 'b1', name: 'boss-1', dir: '/p/boss', at: 4 }

test('an employee cannot hire while its boss is running', async ($, on) => {
  const w = world(on, { 'hire:me': { bossId: 'b1', bossName: 'boss-1', role: 'research' } })
  w.sessions.push(OTHER_BOSS)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_hire', { session: 'quorum', role: 'local' })).toEqual({
    text: "you are on boss-1's team, so you cannot hire; ask boss-1 to hire quorum-63",
    isError: true,
  })
  expect(w.sent).toEqual([])
  expect((await tool($, 'fleet_status')).text).toBe('Your team is empty.')
})

test('a session on another running boss team cannot be hired', async ($, on) => {
  const w = world(on, { 'hire:q1': { bossId: 'b1', bossName: 'boss-1', role: 'local' } })
  w.sessions.push(OTHER_BOSS)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_hire', { session: 'quorum', role: 'research' })).toEqual({
    text: "quorum-63 is on boss-1's team; boss-1 must drop it first",
    isError: true,
  })
  expect(w.sent).toEqual([])
})

test('a team whose boss session is gone holds no one: its employee can hire and be hired', async ($, on) => {
  const gone = { bossId: 'b1', bossName: 'boss-1', role: 'local' }
  const w = world(on, { 'hire:me': gone, 'hire:q1': gone })
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_hire', { session: 'quorum', role: 'research' })).toEqual({ text: 'briefed quorum-63 as Research', isError: false })
  expect(JSON.stringify(w.sent[0]?.to)).toContain('q1')
})

test('fleet_hire of a session outside the boss root is an error that says so, and sends nothing', async ($, on) => {
  const w = world(on)
  w.sessions.push({ id: 'o1', name: 'outsider-7', dir: '/elsewhere/app', state: 'busy', at: 4 })
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_hire', { session: 'outsider', role: 'local' })).toEqual({
    text: "outsider-7 is outside this project's root",
    isError: true,
  })
  expect(w.sent).toEqual([])
  expect((await tool($, 'fleet_status')).text).toBe('Your team is empty.')
})

test('fleet_hire with an unknown session or role is an error and changes nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_hire', { session: 'nobody', role: 'research' })).toEqual({
    text: 'no running session matches "nobody"',
    isError: true,
  })
  expect(await tool($, 'fleet_hire', { session: 'quorum', role: 'boss' })).toEqual({
    text: 'unknown role "boss"; use specialist, local or research',
    isError: true,
  })
  expect(w.sent).toEqual([])
  expect((await tool($, 'fleet_status')).text).toBe('Your team is empty.')
})

test('fleet_task sends the task from the boss and tracks its id on the team', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await tool($, 'fleet_hire', { session: 'quorum', role: 'research' })
  const out = await tool($, 'fleet_task', { session: 'quorum', text: 'Add tests for the parser.' })
  expect(out.isError).toBe(false)
  expect(out.text).toMatch(/^sent quorum-63 task [a-z0-9]{6}$/)
  expect(w.sent.at(-1)?.text).toMatch(/^Task from claude-mods-1c \(id [a-z0-9]{6}\)\nGoal: Add tests for the parser\.\n/)
  expect((await tool($, 'fleet_status')).text).toMatch(/ {2}task [a-z0-9]{6}: sent/)
})

test('fleet_task passes the scope and the done condition on to the member', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  await tool($, 'fleet_task', { session: 'quorum', text: 'Add tests.', scope: 'src/parser only', done: 'the tests pass' })
  expect(w.sent.at(-1)?.text).toContain('Goal: Add tests.\nScope: src/parser only\nDone when: the tests pass\n')
})

test('fleet_task for a busy member queues the task, says behind which one, and fleet_status lists the queue', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  const first = await tool($, 'fleet_task', { session: 'quorum', text: 'First.' })
  const open = /task ([a-z0-9]{6})$/.exec(first.text)?.[1] ?? ''
  expect(open).toMatch(/^[a-z0-9]{6}$/)
  const sent = w.sent.length
  const second = await tool($, 'fleet_task', { session: 'quorum', text: 'Second.' })
  expect(second.isError).toBe(false)
  expect(second.text).toMatch(new RegExp(`^queued task [a-z0-9]{6} for quorum-63, behind task ${open}$`))
  expect(w.sent.length).toBe(sent)
  expect((await tool($, 'fleet_status')).text).toMatch(/ {2}queued: [a-z0-9]{6}/)
})

test('two fleet_task calls at once both land on the team: one sent, one queued', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  const outs = await Promise.all([
    tool($, 'fleet_task', { session: 'quorum', text: 'First.' }),
    tool($, 'fleet_task', { session: 'quorum', text: 'Second.' }),
  ])
  expect(outs.map(o => o.isError)).toEqual([false, false])
  const status = (await tool($, 'fleet_status')).text
  expect(status).toMatch(/ {2}task [a-z0-9]{6}: sent/)
  expect(status).toMatch(/ {2}queued: [a-z0-9]{6}$/m)
})

test('fleet_task to a role goes to a free member of it; with a session too, or neither, it is an error', async ($, on) => {
  const w = world(on, { 'team:me': { q1: { ...TEAM['team:me'].q1, readyAt: 2 } } })
  await $.session.start(LIVE)
  const out = await tool($, 'fleet_task', { role: 'research', text: 'Find the leak.' })
  expect(out.text).toMatch(/^sent quorum-63 task [a-z0-9]{6}$/)
  expect(JSON.stringify(w.sent.at(-1)?.to)).toContain('q1')
  const sent = w.sent.length
  const both = { text: 'name a session or a role, not both', isError: true }
  expect(await tool($, 'fleet_task', { session: 'quorum', role: 'research', text: 'x' })).toEqual(both)
  expect(await tool($, 'fleet_task', { text: 'x' })).toEqual({ text: 'name a session or a role', isError: true })
  expect(await tool($, 'fleet_task', { role: 'boss', text: 'x' })).toEqual({ text: 'unknown role "boss"; use specialist, local or research', isError: true })
  expect(w.sent.length).toBe(sent)
})

test('a pooled task is kept across a restart, listed by fleet_status, shown in the pane, and fleet_cancel takes it off by id', async ($, on) => {
  const pool = [{ id: 'p1p1p1', role: 'local', text: 'Run the build.', queuedAt: 1 }]
  world(on, { ...TEAM, 'pool:me': pool })
  await $.session.start(LIVE)
  expect((await tool($, 'fleet_status')).text).toContain('- p1p1p1 for Local execution: Run the build.')
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /^unassigned$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Run the build\./ })).toBeDefined()
  await ui.unmount()
  expect(await tool($, 'fleet_cancel', { task: 'p1p1p1' })).toEqual({ text: 'took task p1p1p1 off the pool', isError: false })
  expect((await tool($, 'fleet_status')).text).not.toContain('p1p1p1')
})

test('fleet_task after a task no member has is an error and queues nothing', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_task', { session: 'quorum', text: 'Review.', after: 'zz9zz9' })).toEqual({
    text: 'no task zz9zz9 on the team',
    isError: true,
  })
  expect(w.sent).toEqual([])
  expect((await tool($, 'fleet_status')).text).not.toContain('queued')
})

test('fleet_cancel cancels the open task and tells the member', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  const first = await tool($, 'fleet_task', { session: 'quorum', text: 'First.' })
  const open = /task ([a-z0-9]{6})$/.exec(first.text)?.[1] ?? ''
  expect(await tool($, 'fleet_cancel', { session: 'quorum' })).toEqual({ text: `cancelled task ${open} for quorum-63`, isError: false })
  expect(w.sent.at(-1)?.text).toBe(`Task ${open} is cancelled. Stop work on it; no report is needed.`)
  expect((await tool($, 'fleet_status')).text).toContain(`  task ${open}: cancelled`)
  expect(await tool($, 'fleet_cancel', { session: 'quorum' })).toEqual({ text: 'quorum-63 has no open task', isError: true })
  const second = await tool($, 'fleet_task', { session: 'quorum', text: 'Second.' })
  const next = /task ([a-z0-9]{6})$/.exec(second.text)?.[1] ?? ''
  expect(await tool($, 'fleet_cancel', { task: next })).toEqual({ text: `cancelled task ${next} for quorum-63`, isError: false })
})

test('the status line counts the team while it has one, and is cleared when it is gone', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  await w.clock.advance(4000)
  expect(w.statuses.at(-1)).toBe('fleet 1 on team')
  await tool($, 'fleet_task', { session: 'quorum', text: 'First.' })
  await w.clock.advance(4000)
  expect(w.statuses.at(-1)).toBe('fleet 1 on team · 1 open')
  const count = w.statuses.length
  await w.clock.advance(4000)
  expect(w.statuses.length).toBe(count)
  await tool($, 'fleet_drop', { session: 'quorum' })
  await w.clock.advance(4000)
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('a member row opens its detail: goal, scope, done condition, queue; back returns to the list', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  await tool($, 'fleet_task', { session: 'quorum', text: 'Build the parser.', scope: 'src/parser only', done: 'the tests pass' })
  await tool($, 'fleet_task', { session: 'quorum', text: 'Review it.' })
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'member:q1' })
  for (const text of [/Build the parser\./, /src\/parser only/, /the tests pass/, /^queued/, /Review it\./]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /mnemos-9e/ })).toBeUndefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /mnemos-9e/ })).toBeDefined()
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

test('fleet_task is allowed once the member\'s last task is done', async ($, on) => {
  world(on, DONE_TEAM)
  await $.session.start(LIVE)
  expect((await tool($, 'fleet_task', { session: 'quorum', text: 'Next.' })).isError).toBe(false)
})

test('fleet_task with empty text, or for a session not on the team, is an error and sends nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_task', { session: 'quorum', text: '   ' })).toEqual({
    text: 'type the task first',
    isError: true,
  })
  expect(await tool($, 'fleet_task', { session: 'quorum', text: 'Add tests.' })).toEqual({
    text: 'quorum-63 is not on the team; hire it first with fleet_hire',
    isError: true,
  })
  expect(w.sent).toEqual([])
})

test('fleet_drop tells the member it is off the team and removes it', async ($, on) => {
  const w = world(on, DONE_TEAM)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_drop', { session: 'quorum' })).toEqual({
    text: 'dropped quorum-63 from the team',
    isError: false,
  })
  expect(w.sent.at(-1)?.text).toContain('off the team')
  expect((await tool($, 'fleet_status')).text).toBe('Your team is empty.')
})

test('fleet_drop of a session that is not on the team is an error and sends nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(await tool($, 'fleet_drop', { session: 'quorum' })).toEqual({
    text: 'quorum-63 is not on the team',
    isError: true,
  })
  expect(w.sent).toEqual([])
})

test('fleet_status lists each member with its role, reply state, task and last reply', async ($, on) => {
  world(on, DONE_TEAM)
  await $.session.start(LIVE)
  const out = await tool($, 'fleet_status')
  expect(out.isError).toBe(false)
  expect(out.text).toContain('quorum-63 (session q1): Research, ready')
  expect(out.text).toContain('  task k3x9qa: done')
  expect(out.text).toContain('  last: Built it.\n    done k3x9qa')
})

test('a restarted boss gets its team back from the store', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  expect((await tool($, 'fleet_status')).text).toContain('quorum-63 (session q1): Research')
})

const COMPOSE = {
  model: 'claude-haiku-5-5',
  promptModel: 'claude-haiku-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as never

test('a session with a team is told it is the boss and who its employees are', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  const { sections } = await $.prompt.compose(COMPOSE)
  const boss = sections.find(s => s.id === 'fleet-board:boss')
  expect(boss?.scope).toBe('session')
  expect(boss?.text).toContain('You are the boss')
  expect(boss?.text).toContain('- quorum-63 (session q1): Research')
})

test('a session on no team gets no fleet section in its prompt', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.filter(s => s.id.startsWith('fleet-board:'))).toEqual([])
})

test('a session that was briefed is told whose employee it is and where its reports go', async ($, on) => {
  world(on, { 'hire:me': { bossId: 'm1', bossName: 'mnemos-9e', role: 'local' } })
  await $.session.start(LIVE)
  const { sections } = await $.prompt.compose(COMPOSE)
  const employee = sections.find(s => s.id === 'fleet-board:employee')
  expect(employee?.text).toContain('mnemos-9e (session m1)')
  expect(employee?.text).toContain('Local execution')
  expect(employee?.text).toContain('Send your reports to session m1')
})

test('a boss sees that an employee has replied, from the end of the employee transcript', async ($, on) => {
  const w = world(on, { 'team:me': { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: NOW - 1000 } } })
  w.transcripts['q1'] = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(NOW).toISOString(),
    message: { content: [{ type: 'text', text: 'ready' }] },
  })
  await $.session.start(LIVE)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.find(s => s.id === 'fleet-board:boss')?.text).toContain('- quorum-63 (session q1): Research, ready')
  expect(w.sent).toEqual([])
})

test('the team is read again every few seconds while the session is open, with the pane closed', async ($, on) => {
  const w = world(on, { 'team:me': { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } } })
  w.transcripts['q1'] = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(NOW).toISOString(),
    message: { content: [{ type: 'text', text: 'ready' }] },
  })
  await $.session.start(LIVE)
  expect(w.transcriptReads).toBe(0)
  await w.clock.advance(4000)
  expect(w.transcriptReads).toBeGreaterThan(0)
})

test('with no team the session does not scan or read transcripts in the background', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(8000)
  expect(w.scans).toBe(0)
  expect(w.transcriptReads).toBe(0)
})

test('with nobody on the team but a task in the pool, the background scan keeps running', async ($, on) => {
  const w = world(on, { 'pool:me': [{ id: 'p1p1p1', role: 'local', text: 'Run the build.', queuedAt: 1 }] })
  await $.session.start(LIVE)
  await w.clock.advance(8000)
  expect(w.scans).toBeGreaterThan(0)
})

test('with the pane open and nobody on the team, the other-sessions list is still read in the background', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  const before = w.scans
  await w.clock.advance(8000)
  expect(w.scans).toBeGreaterThan(before)
})

test('a second session start replaces the timer, so one tick reads the team once', async ($, on) => {
  const w = world(on, { 'team:me': { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } } })
  await $.session.start(LIVE)
  await w.clock.advance(4000)
  const once = w.transcriptReads
  expect(once).toBeGreaterThan(0)
  await $.session.start(LIVE)
  w.transcriptReads = 0
  await w.clock.advance(4000)
  expect(w.transcriptReads).toBe(once)
})

test('the boss prompt reads a waiting member from its cursor, so a second prompt reads fewer bytes', async ($, on) => {
  const w = world(on, { 'team:me': { q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research', briefedAt: 1 } } })
  w.transcripts['q1'] = `${JSON.stringify({ type: 'user', timestamp: new Date(NOW).toISOString(), message: { content: [{ type: 'text', text: 'briefing' }] } })}\n`
  await $.session.start(LIVE)
  await $.prompt.compose(COMPOSE)
  const first = w.transcriptBytes
  w.transcriptBytes = 0
  await $.prompt.compose(COMPOSE)
  expect(w.transcriptBytes).toBeLessThan(first)
})
