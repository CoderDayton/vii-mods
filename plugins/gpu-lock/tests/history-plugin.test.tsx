import { expect, test } from 'claude-code/testing'

import { world } from './world'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const SHARED = { options: { mode: 'shared' } }
const PANE = {
  component: 'Pane' as const,
  props: { bodyColumns: 60 } as never,
  requestId: 'gpu-lock',
  viewport: { columns: 60, rows: 60 } as never,
}

const NOW = 1_700_000_000_000
const slot = (session: string, cmd: string, pid: number, since: number) =>
  JSON.stringify({ session, agent: null, cmd, cwd: '/w', why: 'x', needMiB: 4096, pid, since })

const earlier = (agoMs: number, usedMiB: number, extra = '') =>
  `{"at":${NOW - agoMs},"gpus":[{"usedMiB":${usedMiB},"totalMiB":24564,"jobs":{${extra}}}],"jobs":{}}\n`

const lastLine = (file: string | null): string => (file ?? '').trim().split('\n').pop() ?? ''

test('each poll adds a sample to the file every session reads', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await w.clock.advance(100)
  const sample = JSON.parse(lastLine(w.historyFile))
  expect(sample.at).toBe(NOW)
  expect(sample.gpus).toEqual([{ usedMiB: 5589, totalMiB: 24564, jobs: {} }])
})

test('the pane draws samples another session wrote, from before this one began', async ($, on) => {
  const w = world(on, { historyFile: earlier(300_000, 20_000) + earlier(200_000, 12_000) })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /peak 19\.5 GiB/ })).toBeDefined()
  await ui.unmount()
})

test('a session leaves the file alone while a fresh sample is already there', async ($, on) => {
  const w = world(on, { historyFile: earlier(500, 1000) })
  await $.session.start(LIVE)
  await w.clock.advance(100)
  expect((w.historyFile ?? '').trim().split('\n').length).toBe(1)
  await w.clock.advance(3000)
  expect((w.historyFile ?? '').trim().split('\n').length).toBe(2)
})

test('a job gets the memory of the processes under its shell', SHARED, async ($, on) => {
  const w = world(on, {
    lockExit: 4,
    probeOut: `jobs ${slot('sess-1111', 'python a.py', 4242, 1_699_999_940)}\n`,
    gpu: { exit: 0, out: '0, NVIDIA GeForce RTX 4090, 9000, 24564, 90, 60, GPU-x\n' },
    apps: '9000, python3, 4096, GPU-x\n9001, chrome, 512, GPU-x\n',
    ps: '1 0\n4242 1\n9000 4242\n9001 1\n',
  })
  await $.session.start(LIVE)
  await w.clock.advance(100)
  const sample = JSON.parse(lastLine(w.historyFile))
  expect(sample.gpus[0].jobs).toEqual({ '4242': 4096 })
  expect(sample.jobs['4242']).toEqual({ session: 'sess-1111', cmd: 'python a.py' })
})

test('the pane names each job in the legend', SHARED, async ($, on) => {
  const w = world(on, {
    lockExit: 4,
    probeOut: `jobs ${slot('sess-1111', 'python a.py', 4242, 1_699_999_940)}\n`,
    gpu: { exit: 0, out: '0, NVIDIA GeForce RTX 4090, 9000, 24564, 90, 60, GPU-x\n' },
    apps: '9000, python3, 4096, GPU-x\n',
    ps: '1 0\n4242 1\n9000 4242\n',
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /this session · python a\.py/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other processes/ })).toBeDefined()
  await ui.unmount()
})

test('two cards get two charts, each with its own title', async ($, on) => {
  const w = world(on, {
    gpu: {
      exit: 0,
      out: '0, NVIDIA GeForce RTX 4090, 5589, 24564, 3, 41\n1, NVIDIA RTX A2000, 1000, 6000, 0, 40\n',
    },
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /GPU 0 {2}NVIDIA GeForce RTX 4090/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /now 1\.0 of 5\.9 GiB/ })).toBeDefined()
  await ui.unmount()
})

test('a history file nobody can read does not stop the polling', async ($, on) => {
  const w = world(on, { historyFile: 'not a sample\n\u0000\u0001' })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  expect(w.state.get('gpu-lock.snapshot')).toBeDefined()
})

test('in a narrow pane the titles, summaries and legend clip instead of wrapping', SHARED, async ($, on) => {
  const w = world(on, {
    lockExit: 4,
    probeOut: `jobs ${slot('sess-1111', 'python a-very-long-training-script-name.py --epochs 100', 4242, 1_699_999_940)}\n`,
    gpu: { exit: 0, out: '0, NVIDIA GeForce RTX 4090, 9000, 24564, 90, 60, GPU-x\n' },
    apps: '9000, python3, 4096, GPU-x\n',
    ps: '1 0\n4242 1\n9000 4242\n',
  })
  await $.session.start(LIVE)
  await w.clock.advance(3100)
  const narrow = { ...PANE, props: { bodyColumns: 30 } as never, viewport: { columns: 30, rows: 60 } as never }
  const ui = await $.ui.mount({ plugin: 'gpu-lock', surface: 'terminal', ...narrow })
  const wrapOf = async (text: RegExp) =>
    ((await ui.find({ type: 'Text', text })) as { props?: { wrap?: string } } | undefined)?.props?.wrap
  expect(await wrapOf(/^GPU memory$/)).toBe('truncate-end')
  expect(await wrapOf(/^now 8\.8 of 24\.0 GiB/)).toBe('truncate-end')
  expect(await wrapOf(/python a-very-long/)).toBe('truncate-end')
  await ui.unmount()
})
