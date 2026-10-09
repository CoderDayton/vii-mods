import { expect, test } from 'claude-code/testing'

import { LOW_CARD, OWNER, world } from './world'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const QUIET = { ...LIVE, isInteractive: false }

const bash = (command: string, extra: Record<string, unknown> = {}) =>
  ({ tool: 'Bash' as const, tool_use_id: 'tu1', command, ...extra }) as never

const slash = (args: string) => ({
  command: 'gpu',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

const ok = (text = 'done') => ({ result: { stdout: text, stderr: '', interrupted: false } as never, text })

const contextOf = (r: object): string[] => ('context' in r ? ((r.context as string[] | undefined) ?? []) : [])
const denyOf = (r: object): string => ('deny' in r ? ((r.deny as string | undefined) ?? '') : '')

test('session start registers /gpu and starts reading the GPU', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.registered).toEqual(['gpu'])
  await w.clock.advance(3100)
  const snap = w.state.get('gpu-lock.snapshot') as { lock: { kind: string }; gpu: { kind: string } }
  expect(snap.lock.kind).toBe('free')
  expect(snap.gpu.kind).toBe('ok')
})

test('/gpu runs at once, even while a turn is in flight', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.commands).toEqual([{ name: 'gpu', immediate: true }])
})

test('a quiet session (no person at the prompt) does not poll', async ($, on) => {
  const w = world(on)
  await $.session.start(QUIET)
  await w.clock.advance(10_000)
  expect(w.runs.filter(r => r[0] === 'nvidia-smi').length).toBe(0)
})

test('a command that is not a GPU job reaches the tool untouched', async ($, on) => {
  world(on)
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('ls -la'))
  expect(seen).toEqual(['ls -la'])
})

test('a GPU job runs under the lock and the model is told the headroom', async ($, on) => {
  const w = world(on)
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py --device cuda'))
  const wrapped = seen[0] ?? ''
  expect(wrapped.startsWith('if sh -c ')).toBe(true)
  expect(wrapped.includes('&& flock -w 2 9; then')).toBe(true)
  expect(wrapped.includes('\npython train.py --device cuda\n')).toBe(true)
  expect(wrapped.includes('"session":"sess-1111"')).toBe(true)
  expect(contextOf(r).some(c => c.includes('ran under the GPU lock') && c.includes('18.5 of 24.0 GiB free'))).toBe(true)
  const log = w.state.get('gpu-lock.log') as { kind: string; cmd: string }[]
  expect(log.map(l => l.kind)).toEqual(['ran'])
  expect(log[0]?.cmd).toBe('python train.py --device cuda')
})

test('a held lock refuses the command, says who holds it, and never runs it', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(calls).toBe(0)
  const deny = denyOf(r)
  expect(deny.startsWith('gpu-lock: the GPU is locked')).toBe(true)
  expect(deny.includes('session othe')).toBe(true)
  expect(deny.includes('`cargo bench`')).toBe(true)
  expect(w.toasts.some(t => t.includes('GPU locked') && t.includes('python train.py'))).toBe(true)
  const log = w.state.get('gpu-lock.log') as { kind: string }[]
  expect(log.map(l => l.kind)).toEqual(['refused'])
})

test('a lock held by this session is described as this session', async ($, on) => {
  world(on, { lockExit: 0, owner: OWNER.replace('other-session', 'sess-1111') })
  on('tool.call', () => ok())
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(denyOf(r).includes('this session: `cargo bench`')).toBe(true)
})

test('too little free memory refuses with who is using it', async ($, on) => {
  world(on, { gpu: { exit: 0, out: LOW_CARD }, apps: '77, ollama, 18000\n' })
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(calls).toBe(0)
  expect(denyOf(r).startsWith('gpu-lock: not enough free GPU memory')).toBe(true)
  expect(denyOf(r).includes('ollama (17.6 GiB)')).toBe(true)
})

test('a declared need is checked, and a command that fits goes through', async ($, on) => {
  world(on)
  on('tool.call', () => ok())
  await $.session.start(QUIET)
  const big = await $.tool.call(bash('python train.py # gpu 30g'))
  expect(denyOf(big).includes('30.0 GiB')).toBe(true)
  const small = await $.tool.call(bash('python train.py # gpu 4g'))
  expect(denyOf(small)).toBe('')
})

test('a command with # nogpu is never locked', async ($, on) => {
  world(on, { lockExit: 0, owner: OWNER })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py # nogpu'))
  expect(seen).toEqual(['python train.py # nogpu'])
})

test('a background GPU job is told the lock stays held', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ok('started'))
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py', { run_in_background: true }))
  expect(contextOf(r).some(c => c.includes('until it exits') && c.includes('Do not start another GPU job'))).toBe(true)
  const log = w.state.get('gpu-lock.log') as { kind: string; ms: number | null; note: string }[]
  expect(log[0]).toMatchObject({ kind: 'ran', ms: null, note: 'background' })
})

test('a failed command is logged as failed and still carries the note', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ ...ok('boom'), isError: true as const }))
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect('isError' in r && r.isError).toBe(true)
  expect(contextOf(r).some(c => c.includes('ran under the GPU lock'))).toBe(true)
  const log = w.state.get('gpu-lock.log') as { kind: string }[]
  expect(log[0]?.kind).toBe('failed')
})

test('losing the race to another job is logged as refused and the output is left alone', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({
    ...ok('gpu-lock: another job took the GPU lock first, so this command did not run.'),
    isError: true as const,
  }))
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(contextOf(r).some(c => c.includes('ran under the GPU lock'))).toBe(false)
  const log = w.state.get('gpu-lock.log') as { kind: string; note: string }[]
  expect(log[0]).toMatchObject({ kind: 'refused', note: 'another job took the lock first' })
  expect(w.toasts.some(t => t.includes('another job took the lock first'))).toBe(true)
})

test('with a wait set, a held lock queues the job instead of refusing it', { options: { waitSeconds: 30 } }, async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  const seen: string[] = []
  let waitingDuring: unknown
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    waitingDuring = w.state.get('gpu-lock.waiting')
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  expect(seen[0]?.startsWith('if { sh -c ')).toBe(true)
  expect(seen[0]?.includes('+ 30))')).toBe(true)
  expect(waitingDuring).toMatchObject({ cmd: 'python train.py' })
  expect(w.state.get('gpu-lock.waiting')).toBe(null)
})

test('another plugin refusing the call leaves no log entry and no note', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ deny: 'nope' }))
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(denyOf(r)).toBe('nope')
  expect(w.state.get('gpu-lock.log')).toBe(undefined)
})

test('a subagent call is recorded with its agent id', async ($, on) => {
  const seen: string[] = []
  world(on)
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py', { agentId: 'agent-9' }))
  expect(seen[0]?.includes('"agent":"agent-9"')).toBe(true)
})

test('without flock, GPU jobs run unwrapped and the user is told once', async ($, on) => {
  const w = world(on, { ensureExit: 4 })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  await $.tool.call(bash('python train.py'))
  expect(seen).toEqual(['python train.py', 'python train.py'])
  expect(w.toasts.filter(t => t.includes('flock is not installed')).length).toBe(1)
})

test('with no nvidia-smi the lock still works and headroom is unknown', async ($, on) => {
  world(on, { gpu: 'missing' })
  on('tool.call', () => ok())
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(contextOf(r).some(c => c.includes('free memory unknown'))).toBe(true)
})

test('a broken nvidia-smi does not stop a GPU job', async ($, on) => {
  world(on, { gpu: { exit: 9, out: 'NVIDIA-SMI has failed' } })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  expect(seen[0]?.startsWith('if sh -c ')).toBe(true)
})

test('a probe that cannot run does not stop a GPU job: the wrapper still decides', async ($, on) => {
  world(on, { lockExit: 3 })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  expect(seen[0]).toBe('python train.py')
})

test('/gpu off lets GPU jobs through unchecked, /gpu on brings the lock back', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  const off = await $.command.run(slash('off'))
  expect('text' in off && off.text).toBe('gpu-lock is off. GPU commands run unchecked.')
  expect(w.store.get('enabled')).toBe(false)
  await $.tool.call(bash('python train.py'))
  expect(seen).toEqual(['python train.py'])
  const again = await $.command.run(slash('on'))
  expect('text' in again && again.text).toBe('gpu-lock is on.')
  expect(w.store.get('enabled')).toBe(true)
  const r = await $.tool.call(bash('python train.py'))
  expect(denyOf(r).startsWith('gpu-lock: the GPU is locked')).toBe(true)
})

test('a session that starts with the lock turned off stays off', async ($, on) => {
  world(on, { lockExit: 0, owner: OWNER, store: new Map([['enabled', false]]) })
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  expect(seen).toEqual(['python train.py'])
})

test('/gpu status reads fresh and prints the state', async ($, on) => {
  world(on, { lockExit: 0, owner: OWNER })
  await $.session.start(QUIET)
  const text = ((await $.command.run(slash('status'))) as { text?: string }).text ?? ''
  expect(text.includes('Lock: held by session othe: `cargo bench`')).toBe(true)
  expect(text.includes('GPU: NVIDIA GeForce RTX 4090, 5.5 of 24.0 GiB used')).toBe(true)
})

test('/gpu check judges a command without running anything', async ($, on) => {
  world(on)
  await $.session.start(QUIET)
  const r = await $.command.run(slash('check python train.py # gpu 8g'))
  expect('text' in r && r.text).toBe('That counts as a GPU job (python + train.py). It needs 8.0 GiB free.')
})

test('/gpu opens the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(QUIET)
  const r = await $.command.run(slash(''))
  expect('text' in r && r.text).toBe('GPU lock pane opened.')
  expect(w.opened).toEqual(['gpu-lock'])
})

test('/gpu closes the pane when it is open, and opens it again after', async ($, on) => {
  const w = world(on)
  await $.session.start(QUIET)
  await $.command.run(slash(''))
  const closed = await $.command.run(slash(''))
  expect('text' in closed && closed.text).toBe('GPU lock pane closed.')
  expect(w.closed).toEqual(['gpu-lock'])
  const again = await $.command.run(slash(''))
  expect('text' in again && again.text).toBe('GPU lock pane opened.')
  expect(w.opened).toEqual(['gpu-lock', 'gpu-lock'])
})

test('/gpu close closes the pane, and says so when none is open', async ($, on) => {
  const w = world(on)
  await $.session.start(QUIET)
  const none = await $.command.run(slash('close'))
  expect('text' in none && none.text).toBe('The GPU lock pane is not open.')
  expect(w.closed).toEqual([])
  await $.command.run(slash(''))
  const done = await $.command.run(slash('close'))
  expect('text' in done && done.text).toBe('GPU lock pane closed.')
  expect(w.closed).toEqual(['gpu-lock'])
})

test('the pane opens so that Escape closes it', async ($, on) => {
  const w = world(on)
  await $.session.start(QUIET)
  await $.command.run(slash(''))
  expect(w.openArgs[0]?.closeOnEscape).toBe(true)
})

test('/gpu before the session has started says so instead of failing', async ($, on) => {
  world(on)
  const r = await $.command.run(slash('status'))
  expect('text' in r && r.text).toBe('gpu-lock has not started yet.')
})

test('the system prompt gains the GPU rules while on, and loses them while off', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(QUIET)
  const input = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
  const withRules = await $.prompt.compose(input)
  const section = withRules.sections.find(s => s.id === 'gpu-lock:rules')
  expect(section?.text.includes('one CUDA job at a time')).toBe(true)
  expect(section?.text.includes('# gpu 8g')).toBe(true)
  expect(section?.text.includes('# nogpu')).toBe(true)
  await $.command.run(slash('off'))
  const without = await $.prompt.compose(input)
  expect(without.sections.some(s => s.id === 'gpu-lock:rules')).toBe(false)
})

test('a background job that ends tells the user the GPU is free again', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ok('started'))
  await $.session.start(LIVE)
  await $.tool.call(bash('python train.py', { run_in_background: true }))
  w.lockExit = 0
  w.owner = JSON.stringify({ ...JSON.parse(OWNER), session: 'sess-1111', since: 1_700_000_000 })
  await w.clock.advance(3100)
  expect(w.toasts.some(t => t.includes('free again'))).toBe(false)
  w.lockExit = 1
  await w.clock.advance(3100)
  expect(w.toasts.some(t => t.includes('GPU free again'))).toBe(true)
})

test('/clear starts the session log over', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ok())
  await $.session.start(QUIET)
  await $.tool.call(bash('python train.py'))
  expect((w.state.get('gpu-lock.log') as unknown[]).length).toBe(1)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1111', resume: {} } as never)
  expect(w.state.get('gpu-lock.log')).toEqual([])
})

test('the status line carries the lock when the band is hidden', { options: { band: 'never' } }, async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  expect(w.statuses.at(-1)).toBe('GPU locked · session othe · cargo bench · 16m 43s')
  w.lockExit = 1
  await w.clock.advance(3100)
  expect(w.statuses.at(-1)).toBe(undefined)
})

test('the status line stays empty when the band draws the lock', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  expect(w.statuses.filter(s => s !== undefined)).toEqual([])
})

test('a poll that fails does not break the next one', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  w.lockExit = 3
  await w.clock.advance(3000)
  w.lockExit = 1
  await w.clock.advance(3000)
  const snap = w.state.get('gpu-lock.snapshot') as { lock: { kind: string } }
  expect(snap.lock.kind).toBe('free')
})
