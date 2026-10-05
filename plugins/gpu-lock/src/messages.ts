import type { Holder, Reading } from '../types'
import { duration, gib, ratio, shortId } from './format'

const usedBy = (reading: Reading): string => {
  if (reading.kind !== 'ok') return ''
  const top = reading.apps
    .filter(a => a.usedMiB > 0)
    .sort((a, b) => b.usedMiB - a.usedMiB)
    .slice(0, 4)
  return top.map(a => `${a.name} (${gib(a.usedMiB)})`).join(', ')
}

const memoryLine = (reading: Reading): string => {
  if (reading.kind !== 'ok' || reading.gpus.length === 0) return ''
  const used = reading.gpus.reduce((sum, g) => sum + g.usedMiB, 0)
  const total = reading.gpus.reduce((sum, g) => sum + g.totalMiB, 0)
  return `GPU memory: ${ratio(used, total)} used.`
}

export const isMine = (holder: Holder | null, session: string): boolean =>
  holder !== null && holder.session !== '' && holder.session === session

export const whoLabel = (holder: Holder | null, session: string): string => {
  if (holder === null) return 'an unknown process'
  return isMine(holder, session) ? 'this session' : `session ${shortId(holder.session) || '?'}`
}

export const describeHolder = (holder: Holder | null, now: number, session: string): string => {
  if (holder === null) return 'an unknown process'
  const who = whoLabel(holder, session)
  const agent = holder.agent === null ? '' : `, subagent ${shortId(holder.agent)}`
  const cmd = holder.cmd === '' ? 'a command' : `\`${holder.cmd}\``
  return `${who}${agent}: ${cmd} (${duration(now - holder.since)})`
}

export const refusedBusy = (holder: Holder | null, now: number, session: string, reading: Reading): string => {
  const advice = isMine(holder, session)
    ? 'Wait for that job to finish (a background command: read its output until it ends), then run this command again. Do not start a second GPU job.'
    : 'Another job holds the GPU. Wait and retry, or ask the user. Do not start a second GPU job.'
  return [
    'gpu-lock: the GPU is locked, so this command did not run.',
    `Held by ${describeHolder(holder, now, session)}.`,
    memoryLine(reading),
    advice,
  ]
    .filter(l => l !== '')
    .join('\n')
}

export const refusedMemory = (needMiB: number, freeMiB: number, totalMiB: number, reading: Reading): string => {
  const users = usedBy(reading)
  return [
    'gpu-lock: not enough free GPU memory, so this command did not run.',
    `It needs about ${gib(needMiB)}; ${gib(freeMiB)} of ${gib(totalMiB)} are free.`,
    users === '' ? '' : `Used by: ${users}.`,
    'Free some memory, or lower the need by ending the command with `# gpu 4g`, or ask the user.',
  ]
    .filter(l => l !== '')
    .join('\n')
}

export const acquiredNote = (a: {
  freeMiB: number | null
  totalMiB: number | null
  reading: Reading
  background: boolean
}): string => {
  const head =
    a.freeMiB !== null && a.totalMiB !== null
      ? `gpu-lock: this command ran under the GPU lock. ${ratio(a.freeMiB, a.totalMiB)} free at start.`
      : 'gpu-lock: this command ran under the GPU lock; free memory unknown at start.'
  const users = usedBy(a.reading)
  return [
    head,
    users === '' ? '' : `Other GPU users: ${users}.`,
    a.background
      ? 'It is a background command: the lock is held until it exits. Do not start another GPU job before then.'
      : '',
  ]
    .filter(l => l !== '')
    .join('\n')
}
