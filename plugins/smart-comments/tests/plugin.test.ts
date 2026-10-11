import { expect, mock, test } from 'claude-code/testing'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const COMPOSER = { kind: 'composer' as const }
const HOME = '/home/u'

const NOISY = '// check the cache\nconst hit = cache.get(id)\n'
const KEPT = '// 40 ms p99 on the 2024 box\nconst LIMIT = 64\n'

const world = (on: Parameters<typeof mock.clock>[0]) => {
  const w = {
    files: new Map<string, string>(),
    links: new Map<string, string>(),
    // What `git status --porcelain -z` prints, and the files of HEAD by their path in the repository.
    status: '',
    head: new Map<string, string>(),
    prompts: [] as string[],
    toasts: [] as string[],
    // What the next file tool call leaves in the file it names; null removes the file.
    writes: '' as string | null,
    // What the next Bash call does.
    shell: () => undefined as void,
    calls: 0,
    deny: false,
    cwdFails: false,
    realpathFails: false,
  }
  const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => {
    if (w.cwdFails) throw new Error('no cwd')
    return { value: '/work' }
  })
  on('session.repo', () => ({ value: { root: '/work', remote: null, internal: false, name: null } }) as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'HOME' ? HOME : undefined }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }) as never)
  on('process.run', (_$, e) => {
    const last = e.argv[e.argv.length - 1] ?? ''
    if (e.argv[0] === 'git') {
      if (e.argv.includes('status')) return ran(w.status)
      const text = w.head.get(last.replace(/^HEAD:/, ''))
      return text === undefined ? ran('', 128) : ran(text)
    }
    if (w.realpathFails) return ran('', 1)
    const link = [...w.links].find(([from]) => last.startsWith(from))
    return ran(`${link === undefined ? last : link[1] + last.slice(link[0].length)}\n`)
  })
  on('tool.call', (_$, e) => {
    w.calls += 1
    if (w.deny) return { deny: 'no' } as never
    if (e.tool === 'Bash') {
      w.shell()
      return { result: 'ok' } as never
    }
    const args = e as { file_path?: string; path?: string }
    const named = args.file_path ?? args.path ?? ''
    const path = named.startsWith('/') ? named : `/work/${named}`
    if (w.writes === null) w.files.delete(path)
    else w.files.set(path, w.writes)
    return { result: 'ok' } as never
  })
  on('prompt.submit', (_$, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return w
}

type World = ReturnType<typeof world>
type Out = { context?: string[]; deny?: string; result?: string }
const write = async ($: any, w: World, path: string, text: string | null, tool = 'Write'): Promise<Out> => {
  w.writes = text
  const args = tool.startsWith('mcp__') ? { path } : { file_path: path }
  return (await $.tool.call({ tool, tool_use_id: 't', ...args })) as Out
}
const bash = async ($: any, w: World, command: string, effect: () => void): Promise<Out> => {
  w.shell = effect
  return (await $.tool.call({ tool: 'Bash', tool_use_id: 't', command })) as Out
}
// A prompt of the user's and the turn it starts.
const submit = async ($: any, text = 'add the cache') => {
  await $.prompt.submit({ text, wait: false, origin: COMPOSER })
  await $.turn.start({ text, turnId: 't1' })
}
const done = ($: any, over: object = {}) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...over })
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('an edit that adds a comment repeating the code sends Claude a note with the call', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  const out = await write($, w, '/work/src/a.ts', NOISY)
  expect(out.context?.join('\n')).toContain('smart-comments: 1 new comment line in /work/src/a.ts.')
  expect(out.context?.join('\n')).toContain('  L1    repeats the code      // check the cache')
  expect(w.toasts).toEqual([])
})

test('an edit that adds only comments worth keeping, or none, sends nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect((await write($, w, '/work/src/a.ts', KEPT)).context).toBeUndefined()
  expect((await write($, w, '/work/src/b.ts', 'const a = 1\n')).context).toBeUndefined()
  expect((await write($, w, '/work/notes.md', '// check the cache\n')).context).toBeUndefined()
})

test('comments the file already had are not charged to the edit', async ($, on) => {
  const w = world(on)
  w.files.set('/work/src/a.ts', NOISY)
  await $.session.start(LIVE)
  expect((await write($, w, '/work/src/a.ts', `${NOISY}const b = 2\n`, 'Edit')).context).toBeUndefined()
})

const plainFile = (comments: number, code: number): string =>
  [
    ...Array.from({ length: comments }, (_, i) => `// Tail of path ${'abcdefgh'[i]}\nstep${i}()\n`),
    ...Array.from({ length: code }, (_, i) => `const v${i} = make${i}()`),
  ].join('\n')

test('a big edit may hold more plain comments than a small one', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect((await write($, w, '/work/small.ts', plainFile(4, 10))).context?.join('\n')).toContain('the limit is 3')
  expect((await write($, w, '/work/big.ts', plainFile(4, 90))).context).toBeUndefined()
})

test('an MCP file tool with a relative path, and MultiEdit, are checked the same way', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  const out = await write($, w, 'src/a.ts', NOISY, 'mcp__semantic-cache-mcp__write')
  expect(out.context?.join('\n')).toContain('repeats the code')
  expect((await write($, w, '/work/src/m.ts', NOISY, 'MultiEdit')).context?.join('\n')).toContain('repeats the code')
  expect((await write($, w, 'src/a.ts', NOISY, 'mcp__other__search')).context).toBeUndefined()
})

test('a refused call is passed on untouched', async ($, on) => {
  const w = world(on)
  w.deny = true
  await $.session.start(LIVE)
  expect(await write($, w, '/work/src/a.ts', NOISY)).toEqual({ deny: 'no' })
})

test('a check that fails before the call leaves the call to run once, with its own result', async ($, on) => {
  const w = world(on)
  w.cwdFails = true
  await $.session.start(LIVE)
  expect(await write($, w, 'src/a.ts', NOISY, 'mcp__semantic-cache-mcp__write')).toEqual({ result: 'ok' })
  expect(w.calls).toBe(1)
})

test('a file that is gone after the call sends nothing', async ($, on) => {
  const w = world(on)
  w.files.set('/work/src/a.ts', 'const a = 1\n')
  await $.session.start(LIVE)
  expect(await write($, w, '/work/src/a.ts', null)).toEqual({ result: 'ok' })
  expect(w.calls).toBe(1)
})

test('a file too big to read before the call is not charged for the comments it had', async ($, on) => {
  const w = world(on)
  const pad = (n: number) => 'const a = 1\n'.repeat(n)
  w.files.set('/work/src/big.ts', NOISY + pad(40_000))
  await $.session.start(LIVE)
  expect((await write($, w, '/work/src/big.ts', NOISY + pad(10), 'Edit')).context).toBeUndefined()
})

test('files of an installed skill or plugin are left alone, unless a link leads into a checkout', async ($, on) => {
  const w = world(on)
  w.links.set(`${HOME}/.claude/skills/mine`, '/work/skills/mine')
  await $.session.start(LIVE)
  expect((await write($, w, `${HOME}/.claude/plugins/p/a.ts`, NOISY)).context).toBeUndefined()
  expect((await write($, w, `${HOME}/.claude/skills/theirs/a.ts`, NOISY)).context).toBeUndefined()
  expect((await write($, w, `${HOME}/.claude/skills/mine/a.ts`, NOISY)).context?.join('\n')).toContain('repeats the code')
})

test('an installed path whose link cannot be followed is left alone', async ($, on) => {
  const w = world(on)
  w.links.set(`${HOME}/.claude/skills/mine`, '/work/skills/mine')
  w.realpathFails = true
  await $.session.start(LIVE)
  expect(await write($, w, `${HOME}/.claude/skills/mine/a.ts`, NOISY)).toEqual({ result: 'ok' })
})

test('a file that still trips when Claude stops gets one follow-up prompt', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  await write($, w, '/work/src/b.ts', KEPT)
  await done($)
  await settle()
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('smart-comments: comments you added this turn need one more pass.')
  expect(w.prompts[1]).toContain('/work/src/a.ts')
  expect(w.prompts[1]).not.toContain('b.ts')
  await done($)
  await settle()
  expect(w.prompts.length).toBe(2)
})

test('a file Claude cleaned up before it stopped gets no prompt', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  await write($, w, '/work/src/a.ts', 'const hit = cache.get(id)\n')
  await done($)
  await settle()
  expect(w.prompts.length).toBe(1)
})

test('the turn is judged against the file as it was before the first edit', async ($, on) => {
  const w = world(on)
  w.files.set('/work/src/a.ts', 'const a = 1\n')
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', `const a = 1\n${NOISY}`, 'Edit')
  expect((await write($, w, '/work/src/a.ts', `const a = 1\n${NOISY}const b = 2\n`, 'Edit')).context).toBeUndefined()
  await done($)
  await settle()
  expect(w.prompts[1]).toContain('  L2    repeats the code      // check the cache')
})

test('a new prompt starts the count again, and a subagent or a cut-off turn sends nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  await done($, { agentId: 'sub-1' })
  await done($, { reason: 'aborted', isAborted: true })
  await settle()
  expect(w.prompts.length).toBe(1)
  await submit($, 'next job')
  await done($)
  await settle()
  expect(w.prompts.length).toBe(2)
})

test('a file changed through a shell command that names it is checked when Claude stops', async ($, on) => {
  const w = world(on)
  w.head.set('src/a.ts', 'const a = 1\n')
  w.files.set('/work/src/a.ts', 'const a = 1\n')
  await $.session.start(LIVE)
  await submit($)
  await settle()
  const out = await bash($, w, "sed -i '1a // check the cache' src/a.ts && cat > src/new.ts", () => {
    w.files.set('/work/src/a.ts', `const a = 1\n${NOISY}`)
    w.files.set('/work/src/new.ts', NOISY)
    w.status = [' M src/a.ts', '?? src/new.ts', ''].join('\0')
  })
  expect(out).toEqual({ result: 'ok' })
  await done($)
  await settle()
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('1 new comment line in src/a.ts.')
  expect(w.prompts[1]).toContain('  L2    repeats the code      // check the cache')
  expect(w.prompts[1]).toContain('1 new comment line in src/new.ts.')
})

test('a file a shell command moved into place is not charged for the comments it came with', async ($, on) => {
  const w = world(on)
  w.files.set('/work/src/old.ts', NOISY)
  await $.session.start(LIVE)
  await submit($)
  await settle()
  await bash($, w, 'mv src/old.ts src/new.ts', () => {
    w.files.delete('/work/src/old.ts')
    w.files.set('/work/src/new.ts', NOISY)
    w.status = [' D src/old.ts', '?? src/new.ts', ''].join('\0')
  })
  await done($)
  await settle()
  expect(w.prompts.length).toBe(1)
})

test('a prompt typed while Claude worked starts a turn that is checked like any other', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  await $.prompt.submit({ text: 'then add c', wait: false, origin: COMPOSER, turnId: 't1' })
  await done($)
  await settle()
  expect(w.prompts.length).toBe(3)
  await $.turn.start({ text: 'then add c', turnId: 't2' })
  await write($, w, '/work/src/c.ts', NOISY)
  await done($, { turnId: 't2' })
  await settle()
  expect(w.prompts.length).toBe(4)
  expect(w.prompts[3]).toContain('/work/src/c.ts')
  expect(w.prompts[3]).not.toContain('/work/src/a.ts')
})

test('the turn the follow-up prompt starts is not sent back a second time', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  await done($)
  await settle()
  expect(w.prompts.length).toBe(2)
  await $.turn.start({ text: `The smart-comments plugin sent a message:\n${w.prompts[1]}`, turnId: 't2' })
  await write($, w, '/work/src/d.ts', NOISY)
  await done($, { turnId: 't2' })
  await settle()
  expect(w.prompts.length).toBe(2)
  await submit($, 'next job')
  await write($, w, '/work/src/e.ts', NOISY)
  await done($)
  await settle()
  expect(w.prompts.length).toBe(4)
})

test('a file no command names, and a file that was already changed at the prompt, are not Claude’s', async ($, on) => {
  const w = world(on)
  w.head.set('src/mine.ts', 'const a = 1\n')
  w.files.set('/work/src/mine.ts', `const a = 1\n${NOISY}`)
  w.status = [' M src/mine.ts', ''].join('\0')
  await $.session.start(LIVE)
  await submit($)
  await settle()
  await bash($, w, 'bun run gen.ts && touch src/mine.ts', () => {
    w.files.set('/work/out/schema.ts', NOISY)
    w.status = [' M src/mine.ts', '?? out/schema.ts', ''].join('\0')
  })
  await done($)
  await settle()
  expect(w.prompts.length).toBe(1)
})

test('with no shell command in the turn, git is not asked when Claude stops', async ($, on) => {
  const w = world(on)
  w.files.set('/work/src/new.ts', NOISY)
  await $.session.start(LIVE)
  await submit($)
  await settle()
  w.status = ['?? src/new.ts', ''].join('\0')
  await done($)
  await settle()
  expect(w.prompts.length).toBe(1)
})

test('toasts are off unless asked for', { options: { notify: true } }, async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($)
  await write($, w, '/work/src/a.ts', NOISY)
  expect(w.toasts).toEqual(['smart-comments: 1 comment line flagged in /work/src/a.ts'])
  await write($, w, '/work/src/b.ts', KEPT)
  expect(w.toasts.length).toBe(1)
  await done($)
  await settle()
  expect(w.toasts[1]).toBe('smart-comments: sent Claude back to fix comments in 1 file')
})

test('options set the limit and turn docstrings off', { options: { maxPlain: 0, allowDocstrings: false } }, async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect((await write($, w, '/work/a.ts', '// Tail of the happy path\nreturn user\n')).context?.join('\n')).toContain('the limit is 0')
  const doc = await write($, w, '/work/b.ts', '/** Loads a user. */\nexport function loadUser() {}\n')
  expect(doc.context?.join('\n')).toContain('repeats the code')
  expect(doc.context?.join('\n')).not.toContain('Docstrings are fine')
})
