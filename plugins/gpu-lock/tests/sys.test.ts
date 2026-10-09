import { expect, test } from 'claude-code/testing'

import { ensureLock, readGpu, readLock, takeSnapshot } from '../src/sys'
import type { Sys } from '../src/sys'

type Fake = {
  ensureExit?: number
  probeExit?: number
  probeThrows?: boolean
  owner?: string | null
  procs?: string[] | null
  gpu?: { exit: number; out: string } | 'missing'
  apps?: { exit: number; out: string } | 'missing'
}

const CARD = '0, NVIDIA GeForce RTX 4090, 5589, 24564, 3, 41\n'

const fake = (f: Fake = {}): Sys => ({
  process: {
    run: async argv => {
      if (argv[3] === 'gpu-lock-ensure') return { exitCode: f.ensureExit ?? 0, stdout: '', stderr: '' }
      if (argv[3] === 'gpu-lock-probe') {
        if (f.probeThrows === true) throw new Error('spawn failed')
        return { exitCode: f.probeExit ?? 1, stdout: '', stderr: '' }
      }
      const query = argv[1] ?? ''
      const answer = query.startsWith('--query-gpu') ? (f.gpu ?? { exit: 0, out: CARD }) : (f.apps ?? { exit: 0, out: '' })
      if (answer === 'missing') throw new Error('ENOENT')
      return { exitCode: answer.exit, stdout: answer.out, stderr: '' }
    },
  },
  fs: {
    read: async () => {
      if (f.owner === null || f.owner === undefined) throw new Error('ENOENT')
      return f.owner
    },
    exists: async path => {
      if (f.procs === null) return false
      const procs = f.procs ?? ['/proc/self', '/proc/4242']
      return procs.includes(path)
    },
  },
})

const owner = JSON.stringify({ session: 's1', agent: null, cmd: 'python train.py', cwd: '/w', why: 'x', needMiB: null, pid: 4242, since: 1_700_000_000 })

test('ensureLock is fine, or says what is missing', async () => {
  expect(await ensureLock(fake(), '/tmp/gpu-lock/lock')).toBe(null)
  expect(await ensureLock(fake({ ensureExit: 4 }), '/tmp/gpu-lock/lock')).toBe('flock is not installed')
  expect(await ensureLock(fake({ ensureExit: 3 }), '/tmp/gpu-lock/lock')).toBe('the lock file cannot be created or read')
})

test('ensureLock reports a shell that cannot start', async () => {
  const sys = fake()
  sys.process.run = async () => {
    throw new Error('no sh')
  }
  expect(await ensureLock(sys, '/tmp/gpu-lock/lock')).toBe('the shell could not run')
})

test('a free lock reads as free', async () => {
  expect((await readLock(fake({ probeExit: 1 }), '/tmp/gpu-lock/lock')).lock).toEqual({ kind: 'free' })
})

test('a held lock with a live owner names the holder', async () => {
  const { lock: s } = await readLock(fake({ probeExit: 0, owner }), '/tmp/gpu-lock/lock')
  expect(s.kind === 'held' && s.holder?.cmd).toBe('python train.py')
})

test('a held lock whose owner pid is gone has no named holder', async () => {
  const { lock: s } = await readLock(fake({ probeExit: 0, owner, procs: ['/proc/self'] }), '/tmp/gpu-lock/lock')
  expect(s).toEqual({ kind: 'held', holder: null })
})

test('a held lock with no owner file has no named holder', async () => {
  const { lock: s } = await readLock(fake({ probeExit: 0, owner: null }), '/tmp/gpu-lock/lock')
  expect(s).toEqual({ kind: 'held', holder: null })
})

test('without /proc the owner pid is trusted', async () => {
  const { lock: s } = await readLock(fake({ probeExit: 0, owner, procs: null }), '/tmp/gpu-lock/lock')
  expect(s.kind === 'held' && s.holder?.pid).toBe(4242)
})

test('a probe that fails or cannot run is unavailable', async () => {
  const a = await readLock(fake({ probeExit: 3 }), '/tmp/gpu-lock/lock')
  expect(a.lock.kind).toBe('unavailable')
  const b = await readLock(fake({ probeThrows: true }), '/tmp/gpu-lock/lock')
  expect(b.lock).toEqual({ kind: 'unavailable', reason: 'the lock probe could not run' })
})

test('reads the gpu and its processes', async () => {
  const r = await readGpu(fake({ apps: { exit: 0, out: '77, ollama, 4100\n' } }))
  expect(r.kind === 'ok' && r.gpus[0]?.usedMiB).toBe(5589)
  expect(r.kind === 'ok' && r.apps).toEqual([{ pid: 77, name: 'ollama', usedMiB: 4100 }])
})

test('no nvidia-smi reads as none', async () => {
  expect(await readGpu(fake({ gpu: 'missing' }))).toEqual({ kind: 'none' })
})

test('a driver error reads as an error with the first line of its message', async () => {
  const r = await readGpu(fake({ gpu: { exit: 9, out: 'NVIDIA-SMI has failed because it could not communicate\nmore' } }))
  expect(r).toEqual({ kind: 'error', message: 'NVIDIA-SMI has failed because it could not communicate' })
})

test('exit 0 with no devices reads as none', async () => {
  expect(await readGpu(fake({ gpu: { exit: 0, out: 'No devices were found\n' } }))).toEqual({ kind: 'none' })
})

test('a failed process query leaves the gpus and drops the list', async () => {
  const r = await readGpu(fake({ apps: 'missing' }))
  expect(r.kind === 'ok' && r.apps).toEqual([])
  expect(r.kind).toBe('ok')
})

test('a snapshot holds the time, the lock and the gpu', async () => {
  const s = await takeSnapshot(fake({ probeExit: 1 }), '/tmp/gpu-lock/lock', 123)
  expect(s.at).toBe(123)
  expect(s.lock).toEqual({ kind: 'free' })
  expect(s.waiters).toEqual([])
  expect(s.gpu.kind).toBe('ok')
})
