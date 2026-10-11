import { expect, mock, test } from 'claude-code/testing'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const COMPOSER = { kind: 'composer' as const }
const NONE = 'No past session matches.'
const FOUND = '2026-10-09  claude-mods  d18dbf28\n  assistant The doubled brackets are fixed.'

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
  }
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
  expect(cli(w)[0]?.env).toEqual({ LOOKBACK_EMBEDDING_MODEL: 'nomic-embed-text', LOOKBACK_EMBEDDING_URL: 'http://localhost:11434/v1' })
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
