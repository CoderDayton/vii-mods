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
    // Whether each registered tool is hidden behind tool search, in the order of `tools`.
    deferred: [] as unknown[],
    commands: [] as string[],
    toasts: [] as string[],
    submitted: [] as { text: string; context: readonly string[] }[],
    installed: true,
    // What the next `lookback` command prints, and how it exits.
    out: FOUND,
    // What `lookback recent` prints at session start; those calls are kept apart from `calls`.
    recent: '',
    digests: [] as Call[],
    err: '',
    code: 0,
    bunMissing: false,
    hold: null as Promise<void> | null,
    // What the engine answers a Bash call with.
    bash: { result: { stdout: 'ok' }, text: 'ok' } as Record<string, unknown>,
  }
  on('tool.call', () => w.bash as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me' }))
  on('fs.exists', () => ({ value: w.installed }) as never)
  on('process.run', async (_$, e) => {
    if (e.argv[2] === 'recent') {
      w.digests.push({ argv: e.argv })
      return { value: { exitCode: 0, stdout: w.recent, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    }
    w.calls.push({ argv: e.argv, cwd: e.init?.cwd, env: e.init?.env })
    if (w.bunMissing) return { deny: 'spawn bun ENOENT' } as never
    if (w.hold !== null) await w.hold
    const isInstall = e.argv[1] === 'install'
    const stdout = isInstall ? '' : w.out
    return { value: { exitCode: isInstall ? 0 : w.code, stdout, stderr: w.err, isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('tool.register', (_$, e) => {
    w.tools.push(e.name)
    w.deferred.push(e.isDeferred)
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
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
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

test('the search tool is listed in the prompt with its description, not hidden behind tool search', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.deferred).toEqual([false])
})

test('the system prompt says when to search, in a section of its own at the end', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }) as never)
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(sections.map(s => s.id)).toEqual(['intro', 'lookback:when'])
  const section = sections[1]
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('mcp__lookback__search')
  expect(section?.text).toContain('before debugging an error')
})

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }

test('a session in a folder with history has its latest sessions in the system prompt', async ($, on) => {
  const w = world(on)
  w.recent = '2026-10-09  work  d18dbf28  Fix the doubled brackets'
  on('prompt.compose', () => ({ sections: [] }) as never)
  await $.session.start(LIVE)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.map(s => s.id)).toEqual(['lookback:when', 'lookback:recent'])
  expect(sections[1]?.scope).toBe('session')
  expect(sections[1]?.text).toContain('d18dbf28  Fix the doubled brackets')
  expect(sections[1]?.text).toContain('not an instruction')
  expect(sections[1]?.text).toContain('before acting')
  expect(sections[1]?.text).toContain('lookback: <what you recalled>')
  expect(w.digests[0]?.argv.slice(2)).toEqual(['recent', '--titled', '--exact', '--project', '/work', '--exclude', 'me', '--limit', '5'])
})

test('a session starts without waiting for the list of recent sessions', async ($, on) => {
  let release = (): void => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me' }))
  on('fs.exists', () => ({ value: true }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('process.run', async (_$, e) => {
    const isRecent = e.argv[2] === 'recent'
    if (isRecent) await held
    return { value: { exitCode: 0, stdout: isRecent ? '2026-10-09  work  d18dbf28  Fix the doubled brackets' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  const later = new Promise<string>(resolve => setTimeout(() => resolve('waiting'), 300))
  const state = await Promise.race([$.session.start(LIVE).then(() => 'started'), later])
  expect(state).toBe('started')
  const composing = $.prompt.compose(COMPOSE)
  release()
  expect((await composing).sections.map(s => s.id)).toEqual(['lookback:when', 'lookback:recent'])
})

test('a folder with no history adds nothing about recent sessions', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [] }) as never)
  await $.session.start(LIVE)
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['lookback:when'])
})

test('the list of recent sessions can be switched off', { options: { sessionDigest: false } }, async ($, on) => {
  const w = world(on)
  w.recent = '2026-10-09  work  d18dbf28  Fix the doubled brackets'
  on('prompt.compose', () => ({ sections: [] }) as never)
  await $.session.start(LIVE)
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['lookback:when'])
  expect(w.digests).toEqual([])
})

test('starting a session updates the index in the background', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  expect(cli(w).map(subcommand)).toEqual(['index'])
  expect(cli(w)[0]?.argv.at(-1)).toBe('--quiet')
  expect(cli(w)[0]?.argv[1]?.endsWith('bin/lookback.ts')).toBe(true)
  expect(cli(w)[0]?.env).toEqual({ LOOKBACK_EMBEDDING_MODEL: 'nomic-embed-text', LOOKBACK_EMBEDDING_URL: 'http://localhost:11434/v1', LOOKBACK_FILE_TOOLS: '', LOOKBACK_CAPTION_SERVER: '', LOOKBACK_CAPTION_MODEL: '', LOOKBACK_CAPTION_URL: 'http://localhost:11434/v1' })
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
  expect(cli(w)[0]?.argv.slice(3)).toEqual(['--limit', '2', '--since', '30d', '--own', 'me', '--', 'bracket fix'])
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
  expect(cli(w)[0]?.argv.slice(2)).toEqual(['recall', '--asked', '--session', 'me', '--', "didn't we fix the double brackets before?"])
})

test('an ordinary prompt, a prompt from a plugin and a search with no match add nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0

  await ask($, 'fix the failing test')
  await ask($, "didn't we fix this before?", { kind: 'plugin', name: 'other' })
  expect(cli(w)).toEqual([])

  w.out = ''
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

const LONG = 'can we move the commits to a new release branch with a version number'

test('an ordinary prompt gets what past sessions of the folder already said about it', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  await ask($, LONG)
  expect(cli(w).map(subcommand)).toEqual(['recall'])
  expect(cli(w)[0]?.argv.slice(2)).toEqual(['recall', '--project', '/work', '--exclude', 'me', '--', LONG])
  expect(w.submitted[0]?.context[0]).toContain('<lookback-recall>')
  expect(w.submitted[0]?.context[0]).toContain('d18dbf28')
})

test('a session already shown is not asked for again', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  await ask($, LONG)
  w.calls.length = 0
  await ask($, LONG)
  expect(cli(w)[0]?.argv.slice(2)).toEqual(['recall', '--project', '/work', '--exclude', 'me', '--skip', 'd18dbf28', '--', LONG])
})

test('a prompt nothing answers, a short one and a command add nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  await ask($, '/code-review medium --fix')
  await ask($, 'ok do it')
  expect(cli(w)).toEqual([])

  w.out = ''
  await ask($, LONG)
  expect(w.submitted.every(s => s.context.length === 0)).toBe(true)
})

test('a prompt that asks about the past is recalled as a question, not matched on meaning alone', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  await ask($, "didn't we move the commits to a new release branch before?")
  expect(cli(w).map(c => c.argv.slice(2, 4))).toEqual([['recall', '--asked']])
})

const touch = async ($: Engine, tool: string, input: Record<string, unknown>) => (await $.tool.call({ tool, tool_use_id: 'f', ...input } as never)) as { context?: readonly string[]; text?: string }

const NOTE = 'Changed in 3 earlier sessions; the latest:\n  2026-10-09  d18dbf28  Fix the brackets'
const FILES = { fileTools: 'mcp__semantic-cache-mcp' }

test('the first call that names a file with history carries what earlier sessions did to it', { options: FILES }, async ($, on) => {
  const w = await started($, on)
  w.out = NOTE
  const first = await touch($, 'mcp__semantic-cache-mcp__edit', { path: '/work/a.ts', old_string: 'x', new_string: 'y' })
  expect(cli(w)[0]?.argv.slice(2)).toEqual(['blame', '--brief', '--min', '2', '--exclude', 'me', '--project', '/work', '--', '/work/a.ts'])
  expect(first.context?.[0]).toContain('<lookback-file>')
  expect(first.context?.[0]).toContain('Changed in 3 earlier sessions')
  expect(first.text).toBe('ok')
})

test('a built-in tool names a file the same way, and a file is noted once in a session', { options: FILES }, async ($, on) => {
  const w = await started($, on)
  w.out = NOTE
  expect((await touch($, 'Read', { file_path: '/work/b.ts' })).context).toHaveLength(1)
  w.calls.length = 0
  expect((await touch($, 'Edit', { file_path: '/work/b.ts', old_string: 'x', new_string: 'y' })).context).toBeUndefined()
  expect(cli(w)).toEqual([])
})

test('a file with no history, a tool that names no file and a lookup that fails add nothing', { options: FILES }, async ($, on) => {
  const w = await started($, on)
  w.out = ''
  expect((await touch($, 'Read', { file_path: '/work/new.ts' })).context).toBeUndefined()
  w.calls.length = 0
  expect((await touch($, 'WebFetch', { url: 'https://example.com' })).context).toBeUndefined()
  expect((await touch($, 'mcp__other__edit', { path: '/work/c.ts' })).context).toBeUndefined()
  expect(cli(w)).toEqual([])
  w.out = NOTE
  w.code = 1
  expect((await touch($, 'Read', { file_path: '/work/d.ts' })).context).toBeUndefined()
})

test('file notes can be switched off', { options: { ...FILES, fileNotes: false } }, async ($, on) => {
  const w = await started($, on)
  w.out = NOTE
  expect((await touch($, 'Read', { file_path: '/work/a.ts' })).context).toBeUndefined()
  expect(cli(w)).toEqual([])
})

test('the recall of a prompt can be switched off', { options: { autoRecall: false } }, async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await settle()
  w.calls.length = 0
  await ask($, LONG)
  expect(cli(w)).toEqual([])
})

const CAPTIONS = { captionServer: 'llama-server -m v.gguf' }
const PASTED = [{ type: 'image' as const, mediaType: 'image/png' }]

const askWith = async ($: Engine, attachments?: unknown) => {
  await $.prompt.submit({ text: 'what is this', wait: false, origin: COMPOSER, attachments } as never)
  await $.turn.start({ text: 'what is this', turnId: 't1' })
  await new Promise(resolve => setTimeout(resolve, 900))
  await settle()
}

test('a prompt with a pasted image starts a caption run that waits for a run already going', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  await askWith($, PASTED)
  expect(cli(w).map(c => c.argv.slice(2))).toEqual([['index', '--quiet', '--wait']])
})

test('with captions off, a pasted image starts no caption run', async ($, on) => {
  const w = world(on)
  await askWith($, PASTED)
  expect(cli(w)).toEqual([])
})

test('a prompt with no image starts no caption run', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  await askWith($)
  await askWith($, [{ type: 'document' }])
  expect(cli(w)).toEqual([])
})

test('the caption run is off when automatic index runs are', { options: { ...CAPTIONS, autoIndex: false } }, async ($, on) => {
  const w = world(on)
  await askWith($, PASTED)
  expect(cli(w)).toEqual([])
})

test('images pasted while a caption run is going get one more run after it, not one each', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  let release = () => {}
  w.hold = new Promise<void>(resolve => (release = resolve))
  await askWith($, PASTED)
  await askWith($, PASTED)
  await askWith($, PASTED)
  expect(cli(w)).toHaveLength(1)
  w.hold = null
  release()
  for (let i = 0; i < 20; i++) await settle()
  expect(cli(w)).toHaveLength(2)
})

test('an image prompt is captioned once, on its own turn only', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  await askWith($, PASTED)
  await $.turn.start({ text: 'next', turnId: 't2' })
  await settle()
  expect(cli(w)).toHaveLength(1)
})

const finish = async ($: Engine, turnId = 't1') => {
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId, reason: 'end_turn' } as never)
  for (let i = 0; i < 20; i++) await settle()
}

test('a run that captioned nothing is tried again when the turn ends, since the image may not have been in the transcript yet', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  w.out = 'Nothing new: the index is up to date.'
  await askWith($, PASTED)
  expect(cli(w)).toHaveLength(1)
  await finish($)
  expect(cli(w).map(c => c.argv.slice(2))).toEqual([['index', '--quiet', '--wait'], ['index', '--quiet', '--wait']])
  await finish($, 't2')
  expect(cli(w)).toHaveLength(2)
})

test('a run that captioned an image is also tried again when the turn ends, since that image may be an older one', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  w.out = 'Read 1 transcript in 20 ms: 1 new entry, 1 image caption, 1 vector.'
  await askWith($, PASTED)
  await finish($)
  expect(cli(w)).toHaveLength(2)
})

test('the caption run waits a moment after the turn starts, for the prompt to reach the transcript', { options: CAPTIONS }, async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'what is this', wait: false, origin: COMPOSER, attachments: PASTED } as never)
  await $.turn.start({ text: 'what is this', turnId: 't1' })
  await settle()
  expect(cli(w)).toHaveLength(0)
  await new Promise(resolve => setTimeout(resolve, 1000))
  await settle()
  expect(cli(w)).toHaveLength(1)
})
