import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CaptionUnavailableError, captionSourceFor } from '../../src/runtime/captions/captioner'
import { leaseServer } from '../../src/runtime/captions/keeper'
import { configFrom } from '../../src/runtime/config'
import { tempDir } from './helpers'

const FAKE = join(import.meta.dir, 'fake-vlm.ts')
const COMMAND = `${process.execPath} ${FAKE}`
const PNG = new TextEncoder().encode('png bytes')

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const until = async (done: () => boolean, ms = 8000): Promise<boolean> => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (done()) return true
  return done()
}

let tmp = tempDir()
const state = (): { keeper: number; server: number; baseURL: string } => JSON.parse(readFileSync(join(tmp.path, 'caption-server.json'), 'utf8'))

afterEach(() => {
  try {
    process.kill(state().keeper, 'SIGTERM')
  } catch {}
  tmp.remove()
  tmp = tempDir()
})

const lease = (command = COMMAND, idleMs = 1500) => leaseServer({ command, statePath: join(tmp.path, 'caption-server.json'), idleMs })

test('a second lease reuses the server the first one started', async () => {
  const first = await lease()
  const second = await lease()
  expect(second.baseURL).toBe(first.baseURL)
  expect(alive(state().server)).toBe(true)
})

test('leases taken at the same time start one server between them', async () => {
  let peak = 0
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, Number(Bun.spawnSync(['pgrep', '-fc', `${FAKE} --host`]).stdout.toString().trim() || 0))
      await Bun.sleep(10)
    }
  })()
  const [a, b, c] = await Promise.all([lease(), lease(), lease()])
  sampling = false
  await sampler
  expect(b.baseURL).toBe(a.baseURL)
  expect(c.baseURL).toBe(a.baseURL)
  expect(peak).toBe(1)
})

test('the server and its keeper are gone once nothing has used them for the idle time', async () => {
  await lease()
  const { keeper, server } = state()
  expect(await until(() => !alive(keeper) && !alive(server))).toBe(true)
  expect(existsSync(join(tmp.path, 'caption-server.json'))).toBe(false)
})

test('a touch keeps the server up past the idle time', async () => {
  const held = await lease()
  for (let i = 0; i < 4; i++) {
    await Bun.sleep(600)
    held.touch()
  }
  expect(alive(state().server)).toBe(true)
})

test('a changed server command replaces the running server', async () => {
  const first = await lease(`${COMMAND} --extra-a`)
  const old = state().server
  const second = await lease(`${COMMAND} --extra-b`)
  expect(second.baseURL).not.toBe(first.baseURL)
  expect(await until(() => !alive(old))).toBe(true)
})

test('a server that cannot start is an error that says how it ended', async () => {
  const start = lease(`${process.execPath} -e process.exit(3)`)
  await expect(start).rejects.toBeInstanceOf(CaptionUnavailableError)
  await expect(start).rejects.toThrow(/exited with code 3/)
})

test('a caption asks for a new server when the one it used has gone', async () => {
  const config = configFrom({ HOME: tmp.path, LOOKBACK_DB: join(tmp.path, 'index.sqlite'), LOOKBACK_CAPTION_SERVER: COMMAND })
  const session = await captionSourceFor(config, 1500)!.open()
  await session.captioner.caption(PNG, 'image/png')
  process.kill(state().server, 'SIGKILL')
  expect(JSON.parse(await session.captioner.caption(PNG, 'image/png')).image).toBe('data:image/png;base64,')
  await session.close()
})
