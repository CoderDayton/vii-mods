import { expect, test } from 'claude-code/testing'

import { LOW_CARD, OWNER, world } from './world'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false } as never }
const PANE = { component: 'Pane' as const, props: {} as never, requestId: 'gpu-lock' }

const answerBelow = (on: Parameters<typeof world>[0]) =>
  on('ui.render', (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>baseline</Text>
  })

test('the band names the holder and the command on every surface', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  answerBelow(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'gpu-lock', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /GPU locked/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cargo bench/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band truncates the command instead of wrapping it', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  answerBelow(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...BAND })
  const cmd = (await ui.find({ type: 'Text', text: /cargo bench/ })) as { props?: { wrap?: string } } | undefined
  expect(cmd).toBeDefined()
  expect(cmd?.props?.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('the band draws under another plugin band instead of hiding it', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  on('ui.render', (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>baseline</Text>
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /baseline/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /GPU locked/ })).toBeDefined()
  await ui.unmount()
})

test('the band shows nothing while the GPU is free and the band is auto', async ($, on) => {
  const w = world(on)
  on('ui.render', (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>baseline</Text>
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /GPU/ })).toBeUndefined()
  await ui.unmount()
})

test('the band shows a free GPU when set to always', { options: { band: 'always' } }, async ($, on) => {
  const w = world(on)
  answerBelow(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /GPU free/ })).toBeDefined()
  await ui.unmount()
})

test('the band stays out of the way of a survey', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  on('ui.render', (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>baseline</Text>
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({
    plugin: 'gpu-lock',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: true } as never,
  })
  expect(await ui.find({ type: 'Text', text: /GPU locked/ })).toBeUndefined()
  await ui.unmount()
})

test('the band fits a narrow terminal', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER })
  answerBelow(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({
    plugin: 'gpu-lock',
    surface: 'terminal',
    ...BAND,
    viewport: { columns: 30, rows: 20 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /GPU locked/ })).toBeDefined()
  await ui.unmount()
})

test('the pane shows a locked GPU, its memory, and the session log', async ($, on) => {
  const w = world(on, { lockExit: 0, owner: OWNER, apps: '77, ollama, 18000\n' })
  on('tool.call', () => ({ deny: 'x' }))
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't', command: 'python train.py' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'gpu-lock', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Locked by session othe/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /RTX 4090/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ollama/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane shows a free GPU and a low-memory card', async ($, on) => {
  const w = world(on, { gpu: { exit: 0, out: LOW_CARD }, apps: '77, ollama, 18000\n' })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Free/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ollama/ })).toBeDefined()
  await ui.unmount()
})

test('the pane says so when the lock cannot be used', async ($, on) => {
  const w = world(on, { ensureExit: 4 })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Lock unavailable/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /flock is not installed/ })).toBeDefined()
  await ui.unmount()
})

test('pressing Turn off in the pane turns the lock off, and Turn on brings it back', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  await ui.press({ key: 'toggle' })
  expect(w.store.get('enabled')).toBe(false)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Turned off/ })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(w.store.get('enabled')).toBe(true)
  await ui.unmount()
})

test('the pane has a Close button on every surface, and pressing it closes the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  for (const surface of SURFACES) {
    w.closed.length = 0
    const ui = await $.ui.mount({ plugin: 'gpu-lock', surface, ...PANE })
    expect(await ui.find({ type: 'Button', text: /Close/ })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(w.closed).toEqual(['gpu-lock'])
    await ui.unmount()
  }
})

test('pressing Refresh reads the GPU again', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  const before = w.runs.length
  await ui.press({ key: 'refresh' })
  expect(w.runs.length).toBeGreaterThan(before)
  await ui.unmount()
})

test('the pane charts memory over time once the GPU has been read', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({
    plugin: 'gpu-lock',
    surface: 'terminal',
    ...PANE,
    viewport: { columns: 60, rows: 40 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /GPU memory/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /now 5\.5 of 24\.0 GiB · peak 5\.5 GiB/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /10m ago/ })).toBeDefined()
  expect((w.state.get('gpu-lock.history') as unknown[]).length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('the chart draws the shared-mode cap', { options: { mode: 'shared' } }, async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({
    plugin: 'gpu-lock',
    surface: 'terminal',
    ...PANE,
    viewport: { columns: 60, rows: 40 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /╌/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined()
  await ui.unmount()
})

test('a pane with no room left still draws the chart on every surface', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'gpu-lock', surface, ...PANE, viewport: { columns: 40, rows: 12 } as never })
    expect(await ui.find({ type: 'Text', text: /GPU memory/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the chart is as wide as the pane body, not the terminal', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({
    plugin: 'gpu-lock',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gpu-lock',
    props: { bodyColumns: 40 } as never,
    viewport: { columns: 200, rows: 40 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /10m ago {23}now/ })).toBeDefined()
  await ui.unmount()
})
