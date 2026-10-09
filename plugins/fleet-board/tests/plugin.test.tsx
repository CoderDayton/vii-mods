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
      { id: 'me', name: 'claude-mods-1c', dir: '/p/claude-mods', at: 1 },
      { id: 'q1', name: 'quorum-63', dir: '/p/quorum', state: 'busy', at: 2 },
      { id: 'm1', name: 'mnemos-9e', dir: '/p/mnemos', state: 'busy', at: 3, updated: NOW - 3_600_000 },
    ] as Rec[],
    sent: [] as Array<{ to: unknown; text: string }>,
    launched: [] as string[][],
    commands: [] as string[],
    opened: [] as Array<{ id: string; title?: string }>,
    toasts: [] as string[],
    panes: [] as string[],
    probe: 'ghostty\ntmux\ndisplay\n',
    refuse: false,
    transcripts: {} as Record<string, string>,
  }
  const ran = (stdout: string, exitCode = 0) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me' }))
  on('session.root', () => ({ value: '/p/claude-mods' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path === '/p/new' || e.path === '/p/claude-mods' }))
  on('fs.list', () => ({
    value: [
      { name: 'new', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: '.hidden', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
    ],
  }) as never)
  on('process.run', (_$, e) => {
    const tag = e.argv[3]
    if (tag === 'fleet-board-scan') return ran(w.sessions.map(record).join('\n'))
    if (tag === 'fleet-board-probe') return ran(w.probe)
    if (tag === 'fleet-board-transcript') return ran(w.transcripts[e.argv[6] ?? ''] ?? '')
    w.launched.push([...e.argv])
    w.sessions.push({ id: 'n1', name: 'new-1', dir: '/p/new', at: 9 })
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
  return w
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

const slash = (args: string) => ({ command: 'fleet', args }) as never
const run = async ($: Engine, args: string) => ((await $.command.run(slash(args))) as { text: string }).text

const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'fleet-board', surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })

// Opening a session waits for it by sleeping on the clock, which the test moves.
const drive = async (w: ReturnType<typeof world>) => {
  for (let i = 0; i < 4; i++) await w.clock.advance(1000)
}

test('the /fleet command is registered', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.commands).toEqual(['fleet'])
})

test('/fleet opens the pane and lists the other sessions by text', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  expect(w.opened).toEqual([{ id: PANE, title: 'Fleet' }])
  const text = await run($, 'list')
  expect(text.split('\n')[0]).toBe('fleet: 2 sessions · 2 working · 0 on the team')
  expect(text).toContain('quorum-63')
  expect(text).not.toContain('claude-mods-1c')
})

test('the pane shows each session and the numbers that pick them', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /2 sessions · 2 working/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /quorum-63/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /mnemos-9e/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /!/ })).toBeDefined()
  await ui.unmount()
})

test('picking a row then Ping asks that session for status', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'row-q1' })
  await ui.press({ key: 'ping' })
  expect(w.sent.length).toBe(1)
  expect(JSON.stringify(w.sent[0]?.to)).toContain('q1')
  expect(w.sent[0]?.text).toContain('Status?')
  expect(await ui.find({ type: 'Text', text: /asked quorum-63 for status/ })).toBeDefined()
  await ui.unmount()
})

test('Brief sends the briefing for the chosen role and the row shows the role', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'row-m1' })
  await ui.select({ key: 'role', value: 'local' })
  await ui.press({ key: 'brief' })
  expect(JSON.stringify(w.sent[0]?.to)).toContain('m1')
  expect(w.sent[0]?.text).toContain('Employee — Local Execution / Support')
  expect(w.sent[0]?.text.startsWith("claude-mods-1c (session me), the user's boss session")).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Local execution/ })).toBeDefined()
  await ui.unmount()
})

test('typing in the task box and pressing Enter sends a task to the picked session', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'row-q1' })
  await ui.input({ key: 'message', text: 'Add tests.' })
  expect(w.sent).toEqual([{ to: expect.anything(), text: 'Task from claude-mods-1c: Add tests.' }])
  await ui.unmount()
})

test('with no row picked the pane offers no session actions and asks for a number', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Button', text: /^Ping$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Press a number to pick a session/ })).toBeDefined()
  await ui.unmount()
})

test('a message that is not delivered shows in the pane', async ($, on) => {
  const w = world(on)
  w.refuse = true
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'row-q1' })
  await ui.press({ key: 'ping' })
  expect(await ui.find({ type: 'Text', text: /could not reach quorum-63: gone/ })).toBeDefined()
  await ui.unmount()
})

test('New session opens the form, and Open starts claude in the folder and briefs it', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'new' })
  await ui.select({ key: 'dir', value: '/p/new' })
  await ui.select({ key: 'role', value: 'research' })
  await ui.input({ key: 'first-task', text: 'Find the leak.', kind: 'change' } as never)
  await ui.press({ key: 'open' })
  await drive(w)
  expect(w.launched).toEqual([['setsid', '-f', 'ghostty', '--working-directory=/p/new', '-e', 'claude']])
  expect(w.sent.map(s => s.text)).toEqual([expect.stringContaining('Employee — Research / Investigation'), 'Task from claude-mods-1c: Find the leak.'])
  expect(await ui.find({ type: 'Text', text: /opened new-1 in a ghostty window as Research/ })).toBeDefined()
  await ui.unmount()
})

test('/fleet new opens a session from the command line', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  const pending = run($, 'new /p/new research find the leak')
  await drive(w)
  const text = await pending
  expect(w.launched[0]).toEqual(['setsid', '-f', 'ghostty', '--working-directory=/p/new', '-e', 'claude'])
  expect(text).toBe('opened new-1 in a ghostty window as Research')
  expect(w.sent.map(s => s.text)).toEqual([expect.stringContaining('Employee — Research / Investigation'), 'Task from claude-mods-1c: find the leak'])
})

test('/fleet ping team and disband act on the sessions that were briefed', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(await run($, 'ping team')).toBe('nobody is on the team yet; brief a session first')
  await run($, 'brief quorum research')
  w.sent.length = 0
  expect(await run($, 'ping team')).toBe('asked 1 session for status')
  expect(await run($, 'disband')).toBe('disbanded the team of 1')
  expect(await run($, 'list')).toContain('0 on the team')
})

test('close closes the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await run($, '')
  await run($, 'close')
  expect(w.panes).toEqual([])
})

const TEAM = { 'team:me': { q1: { name: 'quorum-63', role: 'research', briefedAt: 1 } } }

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

test('a restarted boss gets its team back from the store', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  expect(await run($, 'list')).toContain('1 on the team')
})

test('the pane says what the team is and what to do with a member', async ($, on) => {
  world(on, TEAM)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Hire a session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Your team/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Other sessions/ })).toBeDefined()
  await ui.press({ key: 'row-q1' })
  expect(await ui.find({ type: 'Button', text: /Hire as/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Drop from team/ })).toBeDefined()
  await ui.unmount()
})

test('Drop from team tells the member it is off the team, then the button is gone', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'row-q1' })
  await ui.press({ key: 'drop' })
  expect(w.sent.length).toBe(1)
  expect(w.sent[0]?.text).toContain('off the team')
  expect(await ui.find({ type: 'Button', text: /Drop from team/ })).toBeUndefined()
  await ui.unmount()
})

test('/fleet drop removes a member from the team', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  expect(await run($, 'drop quorum')).toBe('dropped quorum-63 from the team')
  expect(w.sent[0]?.text).toContain('off the team')
  expect(await run($, 'list')).toContain('0 on the team')
})

test('Disband team asks once more before it tells the team', async ($, on) => {
  const w = world(on, TEAM)
  await $.session.start(LIVE)
  await run($, '')
  const ui = await pane($)
  await ui.press({ key: 'disband' })
  expect(w.sent).toEqual([])
  expect(await ui.find({ type: 'Button', text: /Confirm disband/ })).toBeDefined()
  await ui.press({ key: 'disband' })
  expect(w.sent.length).toBe(1)
  expect(w.sent[0]?.text).toContain('disbanded')
  await ui.unmount()
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
