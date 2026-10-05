import type { Reading, Snapshot } from '../types'
import { classify } from './classify'
import { gib } from './format'
import { describeHolder } from './messages'
import type { Config } from './options'

export type Context = {
  config: Config
  snapshot: Snapshot | null
  enabled: boolean
  isPaneOpen: boolean
  now: number
  session: string
}

export type Outcome = { text: string; action?: 'pane' | 'close' | 'on' | 'off' }

const PANE_CLOSED = 'GPU lock pane closed.'

const HELP = [
  '/gpu                    open the GPU pane, or close it if it is open',
  '/gpu close              close the GPU pane',
  '/gpu status             print the lock and memory state',
  '/gpu on | off           turn the lock on or off',
  '/gpu check <command>    say whether a command counts as a GPU job',
  'Mark a command by ending it with # gpu 8g (needs 8 GiB), # gpu (force the lock) or # nogpu (skip it).',
].join('\n')

const apps = (gpu: Reading): string => {
  if (gpu.kind !== 'ok') return ''
  const users = gpu.apps
    .filter(a => a.usedMiB > 0)
    .sort((a, b) => b.usedMiB - a.usedMiB)
    .map(a => `${a.name} (${gib(a.usedMiB)})`)
  return users.length === 0 ? '' : `Other GPU users: ${users.join(', ')}.`
}

const gpuLines = (gpu: Reading): string[] => {
  if (gpu.kind === 'none') return ['GPU: no NVIDIA GPU or nvidia-smi found.']
  if (gpu.kind === 'error') return [`GPU: nvidia-smi failed: ${gpu.message}.`]
  return gpu.gpus.map(g => {
    const parts = [
      g.name,
      `${(g.usedMiB / 1024).toFixed(1)} of ${gib(g.totalMiB)} used`,
      g.util === null ? '' : `${g.util}% busy`,
      g.tempC === null ? '' : `${g.tempC}°C`,
    ]
    return `${gpu.gpus.length === 1 ? 'GPU' : `GPU ${g.index}`}: ${parts.filter(p => p !== '').join(', ')}.`
  })
}

const lockLine = (s: Snapshot, c: Context): string => {
  if (s.lock.kind === 'free') return 'Lock: free.'
  if (s.lock.kind === 'unavailable') return `Lock: unavailable (${s.lock.reason}).`
  return `Lock: held by ${describeHolder(s.lock.holder, c.now, c.session)}.`
}

const status = (c: Context): string => {
  const { config, snapshot } = c
  const lines = [`gpu-lock is ${c.enabled ? 'on' : 'off'}.`]
  if (snapshot === null) {
    lines.push('Lock: not read yet.')
  } else {
    lines.push(lockLine(snapshot, c), ...gpuLines(snapshot.gpu), apps(snapshot.gpu))
  }
  lines.push(
    `Rules: wait ${config.waitSeconds}s, least free ${gib(config.minFreeMiB)}, band ${config.band}, lock file ${config.lockPath}.`,
  )
  if (config.bad.length > 0) lines.push(`Ignored patterns (not valid): ${config.bad.join(', ')}`)
  return lines.filter(l => l !== '').join('\n')
}

const check = (command: string, c: Context): string => {
  if (command === '') return 'Usage: /gpu check <command>'
  const v = classify(command, { extra: c.config.extra, skip: c.config.skip, lockPath: c.config.lockPath })
  if (!v.gpu) return 'That does not count as a GPU job. End a command with `# gpu` to force the lock.'
  const floor = c.config.minFreeMiB
  const need =
    v.needMiB !== null
      ? `It needs ${gib(v.needMiB)} free.`
      : floor > 0
        ? `It needs ${gib(floor)} free (the least-free rule).`
        : 'It has no memory floor.'
  const devices = v.devices === null ? '' : ` Devices: ${v.devices.join(', ')}.`
  return `That counts as a GPU job (${v.why}). ${need}${devices}`
}

export const runCommand = (args: string, c: Context): Outcome => {
  const trimmed = args.trim()
  const [word = '', ...rest] = trimmed.split(/\s+/)
  const sub = word.toLowerCase()
  if (sub === '') {
    return c.isPaneOpen ? { text: PANE_CLOSED, action: 'close' } : { text: 'GPU lock pane opened.', action: 'pane' }
  }
  if (sub === 'close') return c.isPaneOpen ? { text: PANE_CLOSED, action: 'close' } : { text: 'The GPU lock pane is not open.' }
  if (sub === 'on') return { text: 'gpu-lock is on.', action: 'on' }
  if (sub === 'off') return { text: 'gpu-lock is off. GPU commands run unchecked.', action: 'off' }
  if (sub === 'status') return { text: status(c) }
  if (sub === 'check') return { text: check(trimmed.slice(word.length).trim(), c) }
  if (sub === 'help') return { text: HELP }
  return { text: `Unknown option "${word}".\n${HELP}` }
}
