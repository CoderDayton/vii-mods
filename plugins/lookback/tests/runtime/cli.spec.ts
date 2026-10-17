import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { index } from '../../src/cli/commands/index'
import { main } from '../../src/cli/main'
import { configFrom } from '../../src/runtime/config'
import { Projects, assistantRow, tempDir, userRow } from './helpers'

let projects: Projects
let tmp: ReturnType<typeof tempDir>

beforeEach(() => {
  projects = new Projects()
  tmp = tempDir()
  projects.write('proj', 's1', [
    userRow('Why does ModuleNotFoundError appear when I run the script?', { session: 's1', cwd: '/work/app' }),
    assistantRow('Install pillow: the PIL module was missing from the environment.', { session: 's1', cwd: '/work/app' }),
  ])
  projects.write('proj', 's2', [userRow('Rename the config loader to read settings', { session: 's2', cwd: '/work/api' })])
})

afterEach(() => {
  projects.remove()
  tmp.remove()
})

// A server that is not running, so no test depends on Ollama.
const env = () => ({
  HOME: tmp.path,
  LOOKBACK_PROJECTS: projects.root,
  LOOKBACK_DB: join(tmp.path, 'index.sqlite'),
  LOOKBACK_EMBEDDING_URL: 'http://127.0.0.1:1/v1',
})

// Another process that holds the index for writing, as a running `lookback index` does.
const holdIndex = async (path: string): Promise<{ release: () => void }> => {
  const storeModule = join(import.meta.dir, '../../src/runtime/store/store')
  const script = `const { Store } = await import(${JSON.stringify(storeModule)}); Store.open(process.env.HELD_DB); console.log('ready'); await new Promise(() => {})`
  const child = Bun.spawn(['bun', '-e', script], { env: { ...process.env, HELD_DB: path }, stdout: 'pipe', stderr: 'inherit' })
  const reader = child.stdout.getReader()
  const first = await reader.read()
  if (!new TextDecoder().decode(first.value).includes('ready')) throw new Error('the lock holder did not start')
  return { release: () => child.kill() }
}

const run = async (argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, { env: env(), stdout: t => out.push(t), stderr: t => err.push(t), now: () => Date.parse('2026-10-11T00:00:00Z') })
  return { code, out: out.join(''), err: err.join('') }
}

test('index reads the transcripts, and says the embedding server could not be reached', async () => {
  const { code, out, err } = await run(['index'])
  expect(code).toBe(0)
  expect(out).toContain('Read 2 transcripts')
  expect(out).toContain('3 new entries')
  expect(err).toContain('embedding')
})

test('an index run with nothing new says the index is up to date', async () => {
  await run(['index', '--no-embed'])
  expect((await run(['index', '--no-embed'])).out).toBe('Nothing new: the index is up to date.\n')
})

test('index --wait waits for the run already writing, then reads what is left', async () => {
  const writer = await holdIndex(join(tmp.path, 'index.sqlite'))
  const timer = setTimeout(() => writer.release(), 300)
  const { code, out, err } = await run(['index', '--no-embed', '--wait']).finally(() => {
    clearTimeout(timer)
    writer.release()
  })
  expect(code).toBe(0)
  expect(err).not.toContain('already running')
  expect(out).toContain('Waited for the index run already going.')
  expect(out).toContain('3 new entries')
})

test('search finds a session by its words and names it', async () => {
  await run(['index', '--no-embed'])
  const { code, out } = await run(['search', 'ModuleNotFoundError', '--keyword'])
  expect(code).toBe(0)
  expect(out).toContain('s1')
  expect(out).toContain('ModuleNotFoundError')
  expect(out).not.toContain('s2')
})

test('search takes a multi-word question without quotes', async () => {
  await run(['index', '--no-embed'])
  const { out } = await run(['search', 'config', 'loader', '--keyword'])
  expect(out).toContain('s2')
})

test('search filters by project and leaves out a session', async () => {
  await run(['index', '--no-embed'])
  expect((await run(['search', 'module', '--keyword', '--project', 'api'])).out).toBe('No past session matches.\n')
  expect((await run(['search', 'ModuleNotFoundError', '--keyword', '--exclude', 's1'])).out).toBe('No past session matches.\n')
})

test('--json gives the hits as data', async () => {
  await run(['index', '--no-embed'])
  const { out } = await run(['search', 'ModuleNotFoundError', '--keyword', '--json'])
  const data = JSON.parse(out)
  expect(data.terms).toEqual(['modulenotfounderror'])
  expect(data.semantic).toBe('off')
  expect(data.hits[0].session).toBe('s1')
})

test('a search with no index yet says to run index, with its own exit code', async () => {
  const { code, err } = await run(['search', 'anything'])
  expect(code).toBe(3)
  expect(err).toContain('lookback index')
})

test('a search works while another process is updating the index', async () => {
  await run(['index', '--no-embed'])
  const writer = await holdIndex(join(tmp.path, 'index.sqlite'))
  try {
    const { code, out } = await run(['search', 'ModuleNotFoundError', '--keyword'])
    expect(code).toBe(0)
    expect(out).toContain('s1')
  } finally {
    writer.release()
  }
})

test('an index run while another one writes does nothing and succeeds', async () => {
  const writer = await holdIndex(join(tmp.path, 'index.sqlite'))
  try {
    const { code, err } = await run(['index', '--no-embed'])
    expect(code).toBe(0)
    expect(err).toContain('already running')
  } finally {
    writer.release()
  }
})

test('stats counts what the index holds', async () => {
  await run(['index', '--no-embed'])
  const { out } = await run(['stats'])
  expect(out).toContain('entries   3')
  expect(out).toContain('sessions  2')
})

test('a bad command or flag prints the usage and exits 2', async () => {
  expect((await run(['frobnicate'])).code).toBe(2)
  const bad = await run(['search', 'x', '--nope'])
  expect(bad.code).toBe(2)
  expect(bad.err).toContain('Usage')
  expect((await run(['search'])).code).toBe(2)
  expect((await run(['search', 'x', '--since', 'soon'])).code).toBe(2)
})

test('--help prints the usage and exits 0', async () => {
  const { code, out } = await run(['--help'])
  expect(code).toBe(0)
  expect(out).toContain('lookback search')
})

test('doctor reports the index and the embedding server, and fails only on what is broken', async () => {
  await run(['index', '--no-embed'])
  const { code, out } = await run(['doctor'])
  expect(code).toBe(0)
  expect(out).toContain('index')
  expect(out).toContain('embedding server')
  expect(out).toMatch(/warn/i)
  expect(out).toContain(`bun ${Bun.version}`)
  expect(out).toMatch(/sqlite 3\.\d+/)
})

test('the command line loads the OpenAI client only for a command that embeds or captions', async () => {
  const main = join(import.meta.dir, '../../src/cli/main')
  const script = `await import(${JSON.stringify(main)}); console.log(Object.keys(require.cache).filter(k => k.includes('/node_modules/openai/')).length)`
  const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'inherit' })
  expect((await new Response(child.stdout).text()).trim()).toBe('0')
})

test('doctor finds a missing model file however its flag is written', async () => {
  const out: string[] = []
  const command = `${process.execPath} -m /no/such/model.gguf --mmproj=/no/such/mmproj.gguf --model=${process.execPath}`
  await main(['doctor'], { env: { ...env(), LOOKBACK_CAPTION_SERVER: command }, stdout: t => out.push(t), stderr: () => {}, now: Date.now })
  const line = out.join('').split('\n').find(l => l.includes('image captions')) ?? ''
  expect(line).toContain('/no/such/model.gguf, /no/such/mmproj.gguf not found')
})

test('index --wait gives up on a run that holds the index too long, and says it is still going', async () => {
  const writer = await holdIndex(join(tmp.path, 'index.sqlite'))
  const err: string[] = []
  try {
    const io = { env: env(), stdout: () => {}, stderr: (t: string) => err.push(t), now: Date.now }
    expect(await index(['--no-embed', '--wait'], io, configFrom(env()), 300)).toBe(0)
  } finally {
    writer.release()
  }
  expect(err.join('')).toContain('still running')
})
