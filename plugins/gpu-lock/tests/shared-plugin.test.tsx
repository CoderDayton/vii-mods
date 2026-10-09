import { expect, test } from 'claude-code/testing'

import { world } from './world'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const QUIET = { ...LIVE, isInteractive: false }
const SHARED = { options: { mode: 'shared' } }
const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false } as never }
const PANE = { component: 'Pane' as const, props: {} as never, requestId: 'gpu-lock' }

const bash = (command: string) => ({ tool: 'Bash' as const, tool_use_id: 'tu1', command }) as never
const ok = () => ({ result: { stdout: 'done', stderr: '', interrupted: false } as never, text: 'done' })
const denyOf = (r: object): string => ('deny' in r ? ((r.deny as string | undefined) ?? '') : '')
const contextOf = (r: object): string[] => ('context' in r ? ((r.context as string[] | undefined) ?? []) : [])

const slot = (session: string, cmd: string, pid: number, since: number, needMiB = 4096) =>
  JSON.stringify({ session, agent: null, cmd, cwd: '/w', why: 'x', needMiB, pid, since })

// A: sess-1111 (this session), B: another session, C: a third one waiting.
const A = `jobs ${slot('sess-1111', 'python a.py', 11, 1_699_999_900)}`
const B = `jobs ${slot('beef0000', 'python b.py', 12, 1_699_999_940)}`
const C = `waiting ${slot('cafe0000', 'python c.py', 13, 1_699_999_990)}`

test('shared mode wraps a job in the admission check and a shared lock', SHARED, async ($, on) => {
  const w = world(on)
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py # gpu 4g'))
  const wrapped = seen[0] ?? ''
  expect(wrapped.includes('gpu-lock-admit')).toBe(true)
  expect(wrapped.includes('flock -s -w 2 9')).toBe(true)
  expect(wrapped.includes('"needMiB":4096')).toBe(true)
  expect(contextOf(r).some(c => c.includes('shared GPU mode (limit 75% of memory)'))).toBe(true)
  expect(w.state.get('gpu-lock.log')).toMatchObject([{ kind: 'ran' }])
})

test('shared mode lets a second job start beside a running one', SHARED, async ($, on) => {
  world(on, { lockExit: 4, probeOut: `${B}\n` })
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py # gpu 4g'))
  expect(denyOf(r)).toBe('')
  expect(calls).toBe(1)
})

test('shared mode refuses a job that would pass the limit, naming the running jobs', SHARED, async ($, on) => {
  world(on, { lockExit: 4, probeOut: `${B}\n`, gpu: { exit: 0, out: '0, NVIDIA GeForce RTX 4090, 16000, 24000, 80, 60\n' } })
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return ok()
  })
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py # gpu 4g'))
  expect(calls).toBe(0)
  expect(denyOf(r).startsWith('gpu-lock: shared GPU memory is at its limit')).toBe(true)
  expect(denyOf(r).includes('session beef: `python b.py`')).toBe(true)
})

test('exclusive mode refuses while a shared job runs, and names it', async ($, on) => {
  world(on, { lockExit: 4, probeOut: `${B}\n` })
  on('tool.call', () => ok())
  await $.session.start(QUIET)
  const r = await $.tool.call(bash('python train.py'))
  expect(denyOf(r).startsWith('gpu-lock: the GPU is locked')).toBe(true)
  expect(denyOf(r).includes('session beef')).toBe(true)
})

test('the band shows one line per running job and per waiting session', SHARED, async ($, on) => {
  const w = world(on, { lockExit: 4, probeOut: `${A}\n${B}\n${C}\n` })
  on('ui.render', (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>baseline</Text>
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /python a\.py/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /python b\.py/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /python c\.py/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /GPU waiting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /GPU shared/ })).toBeDefined()
  await ui.unmount()
})

test('the pane lists who runs and who waits for a turn', SHARED, async ($, on) => {
  const w = world(on, { lockExit: 4, probeOut: `${A}\n${B}\n${C}\n` })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Shared by 2 jobs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /75% of memory/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waiting for a turn/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /python c\.py/ })).toBeDefined()
  await ui.unmount()
})

test('the shared rules reach the model', SHARED, async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(QUIET)
  const input = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
  const section = (await $.prompt.compose(input)).sections.find(s => s.id === 'gpu-lock:rules')
  expect(section?.text.includes('shares the GPU between CUDA jobs, up to 75%')).toBe(true)
  expect(section?.text.includes('one CUDA job at a time')).toBe(false)
})
