import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { CaptionUnavailableError, OpenAICaptioner, captionSourceFor } from '../../src/runtime/captions/captioner'
import { startServer } from '../../src/runtime/captions/server'
import { configFrom } from '../../src/runtime/config'

const FAKE = join(import.meta.dir, 'fake-vlm.ts')
const PNG = new TextEncoder().encode('png bytes')

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('a server command is started on a free local port, waited for, asked, and stopped', async () => {
  const server = await startServer(`${process.execPath} ${FAKE} --extra-flag`)
  expect(server.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  const said = JSON.parse(await new OpenAICaptioner({ baseURL: server.baseURL, model: 'local' }).caption(PNG, 'image/png'))
  expect(said).toEqual({ model: 'local', temperature: 0.1, max_tokens: 400, keep_alive: '15s', image: 'data:image/png;base64,', args: ['--extra-flag'] })
  await server.stop()
  expect(alive(server.pid)).toBe(false)
})

test('a server dies with the process that started it, even one killed outright', async () => {
  const module = join(import.meta.dir, '../../src/runtime/captions/server')
  const script = `const { startServer } = await import(${JSON.stringify(module)}); const s = await startServer(${JSON.stringify(`${process.execPath} ${FAKE}`)}); console.log(s.pid); await new Promise(() => {})`
  const owner = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'inherit' })
  const pid = Number(new TextDecoder().decode((await owner.stdout.getReader().read()).value).trim())
  expect(alive(pid)).toBe(true)
  owner.kill('SIGKILL')
  await owner.exited
  for (let i = 0; i < 40 && alive(pid); i++) await Bun.sleep(50)
  expect(alive(pid)).toBe(false)
})

test('a server that exits before it is ready is an error that says how it ended', async () => {
  const start = startServer(`${process.execPath} -e process.exit(3)`)
  await expect(start).rejects.toBeInstanceOf(CaptionUnavailableError)
  await expect(start).rejects.toThrow(/exit/)
})

test('a server command that names no program is an error', async () => {
  await expect(startServer('/no/such/llama-server -m x.gguf')).rejects.toBeInstanceOf(CaptionUnavailableError)
})

test('captions are off unless a server command or a model is set, and a server command wins', async () => {
  expect(captionSourceFor(configFrom({ HOME: '/h' }))).toBeNull()
  expect(captionSourceFor(configFrom({ HOME: '/h', LOOKBACK_CAPTION_MODEL: 'vl' }))?.kind).toBe('url')
  expect(captionSourceFor(configFrom({ HOME: '/h', LOOKBACK_CAPTION_MODEL: 'vl', LOOKBACK_CAPTION_SERVER: 'llama-server -m v.gguf' }))?.kind).toBe('server')
})

test('a running server named by its address is used as it is, and an unreachable one is an error', async () => {
  const server = await startServer(`${process.execPath} ${FAKE}`)
  try {
    const source = captionSourceFor(configFrom({ HOME: '/h', LOOKBACK_CAPTION_MODEL: 'vl', LOOKBACK_CAPTION_URL: server.baseURL }))!
    const session = await source.open()
    expect(JSON.parse(await session.captioner.caption(PNG, 'image/jpeg'))).toMatchObject({ model: 'vl', image: 'data:image/jpeg;base64' })
    await session.close()
    expect(alive(server.pid)).toBe(true)
  } finally {
    await server.stop()
  }
  const gone = captionSourceFor(configFrom({ HOME: '/h', LOOKBACK_CAPTION_MODEL: 'vl', LOOKBACK_CAPTION_URL: 'http://127.0.0.1:1/v1' }))!
  const session = await gone.open()
  await expect(session.captioner.caption(PNG, 'image/png')).rejects.toBeInstanceOf(CaptionUnavailableError)
})
