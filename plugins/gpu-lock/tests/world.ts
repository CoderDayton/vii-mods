import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const CARD = '0, NVIDIA GeForce RTX 4090, 5589, 24564, 3, 41\n'
export const LOW_CARD = '0, NVIDIA GeForce RTX 4090, 24000, 24564, 99, 70\n'

export const OWNER = JSON.stringify({
  session: 'other-session',
  agent: null,
  cmd: 'cargo bench',
  cwd: '/elsewhere',
  why: 'cargo + bench',
  needMiB: null,
  pid: 4242,
  since: 1_699_999_000,
})

export type World = {
  lockExit: number
  ensureExit: number
  owner: string | null
  probeOut: string
  procs: string[]
  gpu: { exit: number; out: string } | 'missing'
  apps: string
  ps: string
  historyFile: string | null
  sessionId: string
  toasts: string[]
  statuses: (string | undefined)[]
  registered: string[]
  commands: { name: string; immediate?: true }[]
  opened: string[]
  openArgs: { id: string; closeOnEscape?: boolean }[]
  closed: string[]
  panes: string[]
  store: Map<string, unknown>
  state: Map<string, unknown>
  runs: string[][]
  clock: ReturnType<typeof mock.clock>
}

export const world = (on: On, init: Partial<World> = {}): World => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const w: World = {
    lockExit: 1,
    ensureExit: 0,
    owner: null,
    probeOut: '',
    procs: ['/proc/self', '/proc/4242'],
    gpu: { exit: 0, out: CARD },
    apps: '',
    ps: '',
    historyFile: null,
    sessionId: 'sess-1111',
    toasts: [],
    statuses: [],
    registered: [],
    commands: [],
    opened: [],
    openArgs: [],
    closed: [],
    panes: [],
    store: new Map(),
    state: new Map(),
    runs: [],
    clock,
    ...init,
  }

  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))

  const versions = new Map<string, number>()
  on('state.get', (_$, e) => {
    const k = `${e.plugin}.${e.key}`
    return { value: { value: w.state.get(k), version: versions.get(k) ?? 0 } }
  })
  on('state.set', (_$, e) => {
    const k = `${e.plugin}.${e.key}`
    const version = (versions.get(k) ?? 0) + 1
    versions.set(k, version)
    w.state.set(k, JSON.parse(JSON.stringify(e.value)))
    return { value: { isSet: true as const, version } }
  })

  on('process.run', (_$, e) => {
    w.runs.push([...e.argv])
    const argv = e.argv
    const ok = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[3] === 'gpu-lock-ensure') return ok('', w.ensureExit)
    if (argv[3] === 'gpu-lock-probe') return ok(w.probeOut, w.lockExit)
    if (argv[3] === 'gpu-lock-history') {
      w.historyFile = `${w.historyFile ?? ''}${argv[6] ?? ''}\n`
      return ok('')
    }
    if (argv[0] === 'ps') return ok(w.ps)
    if (argv[0] === 'nvidia-smi') {
      if (w.gpu === 'missing') throw new Error('ENOENT')
      return (argv[1] ?? '').startsWith('--query-gpu') ? ok(w.gpu.out, w.gpu.exit) : ok(w.apps)
    }
    return ok('')
  })
  on('fs.exists', (_$, e) => ({ value: w.procs.includes(e.path) }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('owner.json') && w.owner !== null) return { value: w.owner }
    if (e.path.endsWith('history.jsonl') && w.historyFile !== null) return { value: w.historyFile }
    throw new Error('ENOENT')
  })

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: w.sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    w.commands.push({ name: e.name, immediate: e.immediate })
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    w.openArgs.push({ id: e.id, closeOnEscape: e.closeOnEscape })
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isOpen: true } as never }
  })
  on('ui.close', (_$, e) => {
    w.closed.push(e.id)
    w.panes = w.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  return w
}
