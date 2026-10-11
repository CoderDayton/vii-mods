import { expect, mock, test } from 'claude-code/testing'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const COMPOSER = { kind: 'composer' as const }
const NONE = 'No past session matches.'
const FOUND = '2026-10-09  claude-mods  d18dbf28\n  assistant The doubled brackets are fixed.'
const NO_FIX = 'No past session got past this error.'
const FIXED = "2026-09-28  app  45b0ec34\n  error     ModuleNotFoundError: No module named 'PIL'\n  then ran  pip install pillow"
const TRACE = "Exit code 1\nTraceback (most recent call last):\n  File \"a.py\", line 2\nModuleNotFoundError: No module named 'PIL'"

type Call = { argv: readonly string[]; cwd?: string; env?: Record<string, string> }

const world = (on: Parameters<typeof mock.clock>[0]) => {
  const w = {
    calls: [] as Call[],
    tools: [] as string[],
    commands: [] as string[],
    toasts: [] as string[],
    submitted: [] as { text: string; context: readonly string[] }[],
    installed: true,
    // What the next `lookback` command prints, and how it exits.
    out: FOUND,
    err: '',
    code: 0,
    bunMissing: false,
    // What the engine answers a Bash call with.
    bash: { result: { stdout: 'ok' }, text: 'ok' } as Record<string, unknown>,
  }
  on('tool.call', () => w.bash as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me' }))
  on('fs.exists', () => ({ value: w.installed }) as never)
  on('process.run', (_$, e) => {
    w.calls.push({ argv: e.argv, cwd: e.init?.cwd, env: e.init?.env })
    if (w.bunMissing) return { deny: 'spawn bun ENOENT' } as never
    const isInstall = e.argv[1] === 'install'
    const stdout = isInstall ? '' : w.out
    return { value: { exitCode: isInstall ? 0 : w.code, stdout, stderr: w.err, isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('tool.register', (_$, e) => {
    w.tools.push(e.name)
    return { value: undefined } as never
  })
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => {
    w.submitted.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const cli = (w: ReturnType<typeof world>) => w.calls.filter(c => c.argv[0] === 'bun' && c.argv[1] !== 'install')
const subcommand = (c: Call) => c.argv[2]

const callTool = async ($: Engine, input: Record<string, unknown>) =>
  (await $.tool.call({ tool: 'mcp__lookback__search', tool_use_id: 't', ...input } as never)) as { result?: string; isError?: boolean }

const ask = async ($: Engine, text: string, origin: object | undefined = COMPOSER) => {
  await $.prompt.submit({ text, wait: false, origin } as never)
}

test('starting a session registers the search tool and the /lookback command', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.tools).toEqual(['search'])
  expect(w.commands).toEqual(['lookback'])
})

test('starting a session updates the index in the background', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  expect(cli(w).map(subcommand)).toEqual(['index'])
  expect(cli(w)[0]?.argv.at(-1)).toBe('--quiet')
  expect(cli(w)[0]?.argv[1]?.endsWith('bin/lookback.ts')).toBe(true)
  expect(cli(w)[0]?.env).toEqual({ LOOKBACK_EMBEDDING_MODEL: 'nomic-embed-text', LOOKBACK_EMBEDDING_URL: 'http://localhost:11434/v1', LOOKBACK_FILE_TOOLS: '' })
})

test('the packages are installed first when they are missing', async ($, on) => {
  const w = world(on)
  w.installed = false
  await $.session.start(LIVE)
  await settle()
  expect(w.calls.map(c => c.argv.slice(0, 3).join(' '))[0]).toBe('bun install --frozen-lockfile')
  expect(w.calls[0]?.cwd).toBeTruthy()
  expect(cli(w).map(subcommand)).toEqual(['index'])
})

test('a start without bun says so once and does not fail', async ($, on) => {
  const w = world(on)
  w.bunMissing = true
  await $.session.start(LIVE)
  await settle()
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('lookback')
})

test('a failed index run is shown as a toast', async ($, on) => {
  const w = world(on)
  w.code = 1
  w.err = 'lookback: disk full'
  await $.session.start(LIVE)
  await settle()
  expect(w.toasts.join('\n')).toContain('disk full')
})

test('the model searches through the tool, and the session that asks is left out', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  const out = await callTool($, { query: 'bracket fix', since: '30d', limit: 2 })
  expect(out).toEqual({ result: FOUND })
  expect(cli(w)[0]?.argv.slice(3)).toEqual(['--limit', '2', '--since', '30d', '--exclude', 'me', '--', 'bracket fix'])
})

test('a bad tool input is answered as an error and runs nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  const out = await callTool($, { query: '' })
  expect(out.isError).toBe(true)
  expect(out.result).toContain('query')
  expect(w.calls).toEqual([])
})

test('a search that fails is answered as an error with the reason', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.code = 3
  w.out = ''
  w.err = 'lookback: no index at /x; run "lookback index" first'
  const out = await callTool($, { query: 'anything' })
  expect(out.isError).toBe(true)
  expect(out.result).toContain('lookback index')
})

const bash = async ($: Engine, command = 'python a.py') => (await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command } as never)) as { context?: readonly string[]; isError?: boolean; text?: string }

const started = async ($: Engine, on: Parameters<typeof mock.clock>[0]) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  return w
}

test('a shell command that fails gets what past sessions ran after the same error', async ($, on) => {
  const w = await started($, on)
  w.bash = { isError: true, result: TRACE, text: TRACE }
  w.out = FIXED
  const out = await bash($)
  expect(out.isError).toBe(true)
  expect(out.text).toBe(TRACE)
  expect(out.context).toHaveLength(1)
  expect(out.context?.[0]).toContain('<lookback-fix>')
  expect(out.context?.[0]).toContain('pip install pillow')
  expect(cli(w)[0]?.argv.slice(2)).toEqual(['fix', '--limit', '2', '--exclude', 'me', '--', "ModuleNotFoundError: No module named 'PIL'"])
})

test('the same error is looked up once in a session', async ($, on) => {
  const w = await started($, on)
  w.bash = { isError: true, result: TRACE, text: TRACE }
  w.out = FIXED
  await bash($)
  const again = await bash($)
  expect(again.context).toBeUndefined()
  expect(cli(w)).toHaveLength(1)
})

test('a command that works, an error no session got past and a lookup that fails add nothing', async ($, on) => {
  const w = await started($, on)
  expect((await bash($)).context).toBeUndefined()
  expect(cli(w)).toEqual([])

  w.bash = { isError: true, result: TRACE, text: TRACE }
  w.out = NO_FIX
  expect((await bash($)).context).toBeUndefined()

  w.bash = { isError: true, result: 'fatal error: disk quota exceeded', text: 'fatal error: disk quota exceeded' }
  w.code = 1
  const failed = await bash($)
  expect(failed.context).toBeUndefined()
  expect(failed.text).toBe('fatal error: disk quota exceeded')

  w.bash = { isError: true, result: 'boom', text: 'boom' }
  w.calls.length = 0
  await bash($)
  expect(cli(w)).toEqual([])
})

test('error hints can be switched off', { options: { errorHints: false } }, async ($, on) => {
  const w = await started($, on)
  w.bash = { isError: true, result: TRACE, text: TRACE }
  w.out = FIXED
  expect((await bash($)).context).toBeUndefined()
  expect(cli(w)).toEqual([])
})

test('the model opens a session, asks for a fix and asks for a command through the same tool', async ($, on) => {
  const w = await started($, on)
  await callTool($, { session: 'd18dbf28', offset: 60 })
  await callTool($, { query: 'ENOENT', mode: 'fix' })
  await callTool($, { query: 'run tests', mode: 'how' })
  await callTool($, { query: 'brackets', offset: 5 })
  expect(cli(w).map(c => c.argv.slice(2, 5).join(' '))).toEqual(['show --offset 60', 'fix --limit 5', 'how --exclude me', 'search --limit 5'])
  expect(cli(w)[3]?.argv).toContain('--offset')
})

test('/lookback fix and how fall back to a search when they find nothing', async ($, on) => {
  const w = await started($, on)
  const run = async (args: string) => ((await $.command.run({ command: 'lookback', args } as never)) as { text: string }).text
  w.out = NO_FIX
  expect(await run('fix the double brackets')).toBe(NO_FIX)
  expect(cli(w).map(subcommand)).toEqual(['fix', 'search'])
  expect(cli(w)[1]?.argv.at(-1)).toBe('fix the double brackets')

  w.calls.length = 0
  w.out = FIXED
  expect(await run('fix ModuleNotFoundError PIL')).toBe(FIXED)
  expect(cli(w).map(subcommand)).toEqual(['fix'])
})

test('/lookback with a question searches, with nothing shows the index, and index and doctor run', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  const run = async (args: string) => ((await $.command.run({ command: 'lookback', args } as never)) as { text: string }).text
  w.calls.length = 0

  expect(await run('bracket fix')).toBe(FOUND)
  expect(cli(w)[0]?.argv.slice(-2)).toEqual(['--', 'bracket fix'])
  await run('')
  await run('doctor')
  await run('index')
  expect(cli(w).map(subcommand)).toEqual(['search', 'stats', 'doctor', 'index'])
})

test('a prompt that asks about earlier work gets the matches beside it', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  await ask($, "didn't we fix the double brackets before?")
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]?.text).toBe("didn't we fix the double brackets before?")
  expect(w.submitted[0]?.context).toHaveLength(1)
  expect(w.submitted[0]?.context[0]).toContain('<lookback-recall>')
  expect(w.submitted[0]?.context[0]).toContain('d18dbf28')
  expect(cli(w)[0]?.argv).toContain('--exclude')
  expect(cli(w)[0]?.argv[cli(w)[0]!.argv.indexOf('--limit') + 1]).toBe('3')
})

test('an ordinary prompt, a prompt from a plugin and a search with no match add nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0

  await ask($, 'fix the failing test')
  await ask($, "didn't we fix this before?", { kind: 'plugin', name: 'other' })
  expect(cli(w)).toEqual([])

  w.out = NONE
  await ask($, "didn't we fix this before?")
  expect(w.submitted.every(s => s.context.length === 0)).toBe(true)
})

test('a recall that fails leaves the prompt as it was', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.code = 1
  w.err = 'boom'
  await ask($, "didn't we fix this before?")
  expect(w.submitted.at(-1)).toEqual({ text: "didn't we fix this before?", context: [] })
  expect(w.toasts).toEqual([])
})
