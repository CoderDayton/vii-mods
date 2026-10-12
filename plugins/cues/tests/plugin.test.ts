import { expect, mock, test } from 'claude-code/testing'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const COMPOSER = { kind: 'composer' as const }
const READY = 'cuesd ready: 151 clips\n'

type On = Parameters<typeof mock.clock>[0]
type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

const world = (on: On, saved?: Record<string, unknown>) => {
  const w = {
    clock: mock.clock(on),
    spawned: [] as (readonly string[])[],
    played: [] as { clips: string; socketPath?: string }[],
    // The level each clip was asked for at, in the order of `played`.
    gains: [] as number[],
    toasts: [] as string[],
    commands: [] as string[],
    // What the player writes before it stays up, or how it fails to start.
    player: { stream: 'stdout' as 'stdout' | 'stderr', text: READY },
    stopPlayer: () => {},
    // What Claude writes in the next step.
    step: [] as string[],
    // The arguments of a tool call Claude makes in the next step.
    toolInput: '',
  }
  mock.store(on, saved === undefined ? {} : { settings: saved })
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1000' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abcdef0123456789' }))
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[] }) {
    w.spawned.push(e.argv)
    yield w.player
    if (w.player.stream === 'stdout') await new Promise<void>(resolve => (w.stopPlayer = resolve))
    return { value: { code: w.player.stream === 'stdout' ? 0 : 1, signal: null } } as never
  } as never)
  on('turn.step', async function* () {
    for (const text of w.step) yield { kind: 'text', index: 0, text }
    if (w.toolInput !== '') yield { kind: 'input', index: 1, json: w.toolInput }
    return { answer: w.step.join(''), toolUses: [] } as never
  } as never)
  on('http.fetch', (_$, e) => {
    const query = e.url.split('?')[1] ?? ''
    w.gains.push(Number(new URLSearchParams(query).get('gain')))
    w.played.push({ clips: query.split('&')[0]?.replace('clips=', '') ?? '', socketPath: e.init?.socketPath })
    return { value: { status: 204, ok: true, headers: {}, text: '' } } as never
  })
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)
  return w
}

// Long enough for the player's first line to come through its stream.
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10))

const start = async ($: Engine, on: On, saved?: Record<string, unknown>) => {
  const w = world(on, saved)
  await $.session.start(LIVE)
  await settle()
  return w
}

// The engine's `$` in a test has `prompt.edit`, though its type does not list it.
const edit = ($: Engine, e: object) => ($.prompt as unknown as { edit: (e: object) => Promise<unknown> }).edit(e)
const key = ($: Engine, name: string, mods: object = {}) =>
  edit($, { origin: COMPOSER, key: { key: name, ...mods }, text: '', cursor: 0, start: 0, end: 0, inputText: name })
const done = ($: Engine, reason: string) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason } as never)
const run = async ($: Engine, args: string) => ((await $.command.run({ command: 'cues', args } as never)) as { text: string }).text
const clips = (w: { played: { clips: string }[] }) => w.played.map(p => p.clips)

test('a session starts the player on its own socket and registers /cues', async ($, on) => {
  const w = await start($, on)
  expect(w.commands).toEqual(['cues'])
  expect(w.spawned.length).toBe(1)
  const argv = w.spawned[0] ?? []
  expect(argv[0]).toBe('bun')
  expect(argv[1]).toContain('/bin/cuesd.ts')
  expect(argv[2]).toContain('/sounds')
  expect(argv[3]).toMatch(/^\/run\/user\/1000\/cues-abcdef01-[0-9a-f]{8}\.sock$/)
})

test('each player gets a socket of its own, so one that is shutting down cannot remove the next one', async ($, on) => {
  const w = await start($, on)
  await $.session.start(LIVE)
  await settle()
  expect(w.spawned.length).toBe(2)
  expect(w.spawned[1]?.[3]).not.toBe(w.spawned[0]?.[3])
})

test('a session with nobody at it starts no player', async ($, on) => {
  const w = world(on)
  await $.session.start({ ...LIVE, isInteractive: false })
  await settle()
  expect(w.spawned).toEqual([])
})

test('a key typed in the prompt box plays its press, then its release', async ($, on) => {
  const w = await start($, on)
  await key($, 'q')
  await settle()
  expect(w.played).toEqual([{ clips: 'keys/mxbrown/press/r1', socketPath: w.spawned[0]?.[3] }])
  await w.clock.advance(100)
  expect(clips(w)).toEqual(['keys/mxbrown/press/r1', 'keys/mxbrown/release/key'])
})

test('a shortcut key and a paste make no sound', async ($, on) => {
  const w = await start($, on)
  await key($, 'c', { ctrl: true })
  await edit($, { origin: COMPOSER, text: '', cursor: 0, start: 0, end: 0, inputText: 'pasted' })
  await w.clock.advance(100)
  expect(w.played).toEqual([])
})

test('nothing plays before the player is ready', async ($, on) => {
  const w = world(on)
  w.player = { stream: 'stdout', text: 'loading\n' }
  await $.session.start(LIVE)
  await settle()
  await key($, 'q')
  await w.clock.advance(100)
  expect(w.played).toEqual([])
})

test('a player that cannot play says why once, and the session stays silent', async ($, on) => {
  const w = world(on)
  w.player = { stream: 'stderr', text: 'cuesd: no audio player found.\n' }
  await $.session.start(LIVE)
  await settle()
  await key($, 'q')
  await w.clock.advance(100)
  expect(w.toasts).toEqual(['cues: no sound. cuesd: no audio player found.'])
  expect(w.played).toEqual([])
  expect(await run($, '')).toContain('no sound: the player is not running')
})

test('sending a prompt plays enter and the send chime', async ($, on) => {
  const w = await start($, on)
  await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER } as never)
  await settle()
  expect(clips(w)).toEqual(['keys/mxbrown/press/enter,keys/mxbrown/press/r2', 'chimes/send'])
})

test('a turn that ends plays the reply chime, a failed one the error chime, a stopped one nothing', async ($, on) => {
  const w = await start($, on)
  await done($, 'answer')
  await done($, 'error')
  await done($, 'aborted')
  await settle()
  expect(clips(w)).toEqual(['chimes/reply,chimes/bell', 'chimes/error'])
})

test('the reply chime is the sound that was picked, unless a reply.wav of the user is there', async ($, on) => {
  const w = await start($, on, { replySound: 'notes' })
  await done($, 'answer')
  await settle()
  expect(clips(w)).toEqual(['chimes/reply,chimes/notes'])
  expect(await run($, 'reply bell')).toBe('Reply chime is now the bell.')
  await settle()
  expect(clips(w)).toEqual(['chimes/reply,chimes/notes', 'chimes/reply,chimes/bell'])
})

test("Claude's writing makes no sound unless it is turned on", async ($, on) => {
  const w = await start($, on)
  w.step = ['hi']
  for await (const _ of $.turn.step({ model: 'm' } as never)) void _
  await w.clock.advance(200)
  expect(w.played).toEqual([])
})

test("turned on, Claude's text is typed out one key at a time", async ($, on) => {
  const w = await start($, on, { claude: true })
  w.step = ['hi']
  for await (const _ of $.turn.step({ model: 'm' } as never)) void _
  await w.clock.advance(76)
  expect(w.played).toEqual([])
  await w.clock.advance(67)
  expect(clips(w)).toEqual(['keys/mxbrown/press/r2'])
  await w.clock.advance(143)
  expect(clips(w).filter(c => c.includes('/press/'))).toEqual(['keys/mxbrown/press/r2', 'keys/mxbrown/press/r1'])
})

test("Claude's text is typed on Claude's own switch, and the user's keys stay on theirs", async ($, on) => {
  const w = await start($, on, { claude: true })
  expect(await run($, 'claude topre')).toBe("Claude's keys now sound like Topre.")
  await settle()
  expect(clips(w)).toEqual(['keys/topre/press/r2'])
  await w.clock.advance(100)
  w.played.length = 0
  w.step = ['h']
  for await (const _ of $.turn.step({ model: 'm' } as never)) void _
  await w.clock.advance(143)
  await key($, 'q')
  await settle()
  expect(clips(w)).toEqual(['keys/topre/press/r2', 'keys/mxbrown/press/r1'])
})

test('a chime plays at the chimes volume, whatever the keys volume is', async ($, on) => {
  const w = await start($, on, { volume: 1, chimeVolume: 0.5 })
  await done($, 'answer')
  await settle()
  expect(w.gains).toEqual([0.25])
})

test('a new volume is heard at once: a key for the keys, a chime for the chimes', async ($, on) => {
  const w = await start($, on)
  await run($, 'volume keys 30')
  await settle()
  expect(clips(w)).toEqual(['keys/mxbrown/press/r2'])
  await w.clock.advance(100)
  w.played.length = 0
  await run($, 'volume chimes 30')
  await settle()
  expect(clips(w)).toEqual(['chimes/send'])
})

test("a tool call's arguments are not typed out", async ($, on) => {
  const w = await start($, on, { claude: true })
  w.toolInput = '{"command":"ls -la"}'
  for await (const _ of $.turn.step({ model: 'm' } as never)) void _
  await w.clock.advance(2000)
  expect(w.played).toEqual([])
})

test('the typing stops when the reply lands', async ($, on) => {
  const w = await start($, on, { claude: true })
  w.step = ['a long line of text']
  for await (const _ of $.turn.step({ model: 'm' } as never)) void _
  await done($, 'answer')
  await w.clock.advance(3000)
  expect(clips(w)).toEqual(['chimes/reply,chimes/bell'])
})

test('/cues off silences everything and is remembered', async ($, on) => {
  const w = await start($, on)
  expect(await run($, 'off')).toBe('Sounds off. /cues on brings them back.')
  await key($, 'q')
  await done($, 'answer')
  await w.clock.advance(100)
  expect(w.played).toEqual([])
  expect(await run($, '')).toContain('Off · keys volume 70')
})

test('saved settings are used from the start', async ($, on) => {
  const w = await start($, on, { switch: 'topre', reply: false })
  await key($, 'q')
  await done($, 'answer')
  await done($, 'error')
  await settle()
  expect(clips(w)).toEqual(['keys/topre/press/r1', 'chimes/error'])
})

test('picking a switch plays a key of it', async ($, on) => {
  const w = await start($, on)
  expect(await run($, 'topre')).toBe('Keys now sound like Topre.')
  await settle()
  expect(clips(w)).toEqual(['keys/topre/press/r2'])
})
