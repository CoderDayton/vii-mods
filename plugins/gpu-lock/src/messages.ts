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

export const describeHolders = (holders: readonly Holder[], now: number, session: string): string =>
  holders.length === 0 ? 'an unknown process' : holders.map(h => describeHolder(h, now, session)).join('; ')

export const refusedBusy = (holders: readonly Holder[], now: number, session: string, reading: Reading): string => {
  const advice = holders.some(h => isMine(h, session))
    ? 'Wait for that job to finish (a background command: read its output until it ends), then run this command again. Do not start a second GPU job.'
    : 'Another job holds the GPU. Wait and retry, or ask the user. Do not start a second GPU job.'
  return [
    'gpu-lock: the GPU is locked, so this command did not run.',
    `Held by ${describeHolders(holders, now, session)}.`,
    memoryLine(reading),
    advice,
  ]
    .filter(l => l !== '')
    .join('\n')
}

export const refusedQueue = (waiters: readonly Holder[], now: number, session: string): string =>
  [
    'gpu-lock: other jobs are waiting for the GPU ahead of this command, so it did not run.',
    `Waiting, in order: ${waiters.map((h, i) => `${i + 1}. ${describeHolder(h, now, session)}`).join('; ')}.`,
    'Wait for them to start, then run this command again, or ask the user. Do not skip the line.',
  ].join('\n')

export const refusedShare = (
  d: { needMiB: number; usedMiB: number; capMiB: number; totalMiB: number; percent: number },
  holders: readonly Holder[],
  now: number,
  session: string,
): string =>
  [
    'gpu-lock: shared GPU memory is at its limit, so this command did not run.',
    `It needs about ${gib(d.needMiB)}; ${gib(d.usedMiB)} of ${gib(d.totalMiB)} are in use, and jobs may use ${d.percent}% (${gib(d.capMiB)}) together.`,
    holders.length === 0 ? '' : `Running: ${describeHolders(holders, now, session)}.`,
    'Wait for a job to end, then run this command again, or lower the need by ending the command with `# gpu 4g`. Do not work around the limit.',
  ]
    .filter(l => l !== '')
    .join('\n')

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
  sharedPercent?: number
}): string => {
  const where = a.sharedPercent === undefined ? 'under the GPU lock' : `in shared GPU mode (limit ${a.sharedPercent}% of memory)`
  const head =
    a.freeMiB !== null && a.totalMiB !== null
      ? `gpu-lock: this command ran ${where}. ${ratio(a.freeMiB, a.totalMiB)} free at start.`
      : `gpu-lock: this command ran ${where}; free memory unknown at start.`
  const users = usedBy(a.reading)
  const hold =
    a.sharedPercent === undefined
      ? 'It is a background command: the lock is held until it exits. Do not start another GPU job before then.'
      : 'It is a background command: its share of the GPU is held until it exits. Count it against the limit before starting another GPU job.'
  return [head, users === '' ? '' : `Other GPU users: ${users}.`, a.background ? hold : '']
    .filter(l => l !== '')
    .join('\n')
}
