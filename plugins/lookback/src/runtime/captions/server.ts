import type { Subprocess } from 'bun'

import { commandWords } from '../../core/text/command'
import { CaptionUnavailableError } from './errors'

export type RunningServer = { baseURL: string; pid: number; stop(): Promise<void> }

const HOST = '127.0.0.1'
// A cold model read from disk can take this long to load.
const READY_MS = 120_000
const POLL_MS = 100
const STOP_MS = 3000
const LOG_TAIL = 2000

const SETPRIV = process.platform === 'linux' ? Bun.which('setpriv') : null

const diesWithParent = (): string[] => (SETPRIV === null ? [] : [SETPRIV, '--pdeathsig', 'KILL', '--'])

const freePort = (): number => {
  const probe = Bun.listen({ hostname: HOST, port: 0, socket: { data() {} } })
  const { port } = probe
  probe.stop(true)
  return port
}

// Reads the server's log as it is written, keeping its end. A pipe nobody reads fills up and stalls the server.
const tailOf = (stream: ReadableStream<Uint8Array>): (() => string) => {
  let tail = ''
  void (async () => {
    for await (const piece of stream) tail = (tail + Buffer.from(piece).toString()).slice(-LOG_TAIL)
  })().catch(() => {})
  return () => tail.trim()
}

export const isReady = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    return false
  }
}

const halt = async (child: Subprocess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const ended = await Promise.race([child.exited.then(() => true), Bun.sleep(STOP_MS).then(() => false)])
  if (!ended) {
    child.kill('SIGKILL')
    await child.exited
  }
}

// Starts a server command, such as llama-server with a vision model, on a free local port, and resolves once
// its /health answers. The server is killed with this process, so a run that is stopped leaves none behind.
export const startServer = async (command: string, readyMs = READY_MS): Promise<RunningServer> => {
  const words = commandWords(command)
  if (words.length === 0) throw new CaptionUnavailableError('the caption server command is empty')
  const port = freePort()
  let child: Subprocess<'ignore', 'ignore', 'pipe'>
  try {
    child = Bun.spawn([...diesWithParent(), ...words, '--host', HOST, '--port', String(port)], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
  } catch (error) {
    throw new CaptionUnavailableError(`could not start ${words[0]}: ${error instanceof Error ? error.message : String(error)}`, error)
  }
  const log = tailOf(child.stderr)
  const kill = (): void => {
    child.kill('SIGKILL')
  }
  const killAndLeave = (signal: NodeJS.Signals): void => {
    kill()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('exit', kill)
  process.once('SIGTERM', killAndLeave)
  process.once('SIGINT', killAndLeave)
  const stop = async (): Promise<void> => {
    process.off('exit', kill)
    process.off('SIGTERM', killAndLeave)
    process.off('SIGINT', killAndLeave)
    await halt(child)
  }

  const root = `http://${HOST}:${port}`
  const deadline = Date.now() + readyMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await stop()
      const how = child.signalCode !== null ? `was killed by ${child.signalCode}` : `exited with code ${child.exitCode}`
      throw new CaptionUnavailableError(`the caption server ${how} before it was ready${log() === '' ? '' : `: ${log()}`}`)
    }
    if (await isReady(`${root}/health`)) return { baseURL: `${root}/v1`, pid: child.pid, stop }
    await Bun.sleep(POLL_MS)
  }
  await stop()
  throw new CaptionUnavailableError(`the caption server was not ready after ${Math.round(readyMs / 1000)} s`)
}
