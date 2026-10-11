import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { main } from '../../src/cli/main'
import { Projects, assistantRow, commandRow, errorRow, tempDir, userRow } from './helpers'

const A = 'aaaa1111-0000-0000-0000-000000000001'
const B = 'aaaa2222-0000-0000-0000-000000000002'
const C = 'cccc3333-0000-0000-0000-000000000003'

let projects: Projects
let tmp: ReturnType<typeof tempDir>

const at = (minute: number): string => `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`

beforeEach(async () => {
  projects = new Projects()
  tmp = tempDir()
  projects.write('proj', A, [
    userRow('Make the thumbnails for the gallery', { session: A, ts: at(0) }),
    commandRow('python make_thumbs.py', { session: A, ts: at(1) }),
    errorRow("Exit code 1\nTraceback (most recent call last):\n  File \"make_thumbs.py\", line 2\nModuleNotFoundError: No module named 'PIL'", { session: A, ts: at(2) }),
    commandRow('pip install pillow', { session: A, ts: at(3) }),
    assistantRow('Installed pillow; the thumbnails are made now.', { session: A, ts: at(4) }),
  ])
  projects.write('proj', B, [
    userRow('Run the thumbnails again', { session: B, cwd: '/work/api', ts: at(10) }),
    commandRow('python make_thumbs.py', { session: B, cwd: '/work/api', ts: at(11) }),
    errorRow("ModuleNotFoundError: No module named 'PIL'", { session: B, cwd: '/work/api', ts: at(12) }),
  ])
  projects.write('proj', C, [userRow('Rename the config loader', { session: C, ts: at(20) }), commandRow('python make_thumbs.py --all', { session: C, ts: at(21) })])
  await run(['index', '--no-embed'])
})

afterEach(() => {
  projects.remove()
  tmp.remove()
})

const env = () => ({
  HOME: tmp.path,
  LOOKBACK_PROJECTS: projects.root,
  LOOKBACK_DB: join(tmp.path, 'index.sqlite'),
  LOOKBACK_EMBEDDING_URL: 'http://127.0.0.1:1/v1',
})

async function run(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, { env: env(), stdout: t => out.push(t), stderr: t => err.push(t), now: () => Date.parse('2026-10-11T00:00:00Z') })
  return { code, out: out.join(''), err: err.join('') }
}

test('show prints a session found by the start of its id, every entry in order', async () => {
  const { code, out } = await run(['show', 'aaaa1'])
  expect(code).toBe(0)
  const lines = out.trimEnd().split('\n')
  expect(lines[0]).toContain(A)
  expect(lines[0]).toContain('5 entries')
  expect(lines.slice(1).map(l => l.slice(6, 15).trim())).toEqual(['user', 'cmd', 'error', 'cmd', 'assistant'])
  expect(lines[4]).toBe('10:03 cmd       pip install pillow')
})

test('show takes a page, a kind and JSON', async () => {
  const page = await run(['show', A, '--offset', '3', '--limit', '1'])
  expect(page.out).toContain('pip install pillow')
  expect(page.out).not.toContain('Installed pillow')
  expect(page.out).toContain('entries 4 to 4 of 5; go on with offset 4')
  expect((await run(['show', A, '--kind', 'cmd'])).out.trimEnd().split('\n')).toHaveLength(3)
  const data = JSON.parse((await run(['show', A, '--json'])).out)
  expect(data.session.session).toBe(A)
  expect(data.entries).toHaveLength(5)
})

test('show lists the sessions when the id fits several, and fails when it fits none', async () => {
  const several = await run(['show', 'aaaa'])
  expect(several.code).toBe(1)
  expect(several.err).toContain('2 sessions')
  expect(several.err).toContain(A)
  expect(several.err).toContain(B)
  const none = await run(['show', 'zzzz'])
  expect(none.code).toBe(1)
  expect(none.err).toContain('no session')
  expect((await run(['show'])).code).toBe(2)
})

test('fix shows what was run after the error in each session that got past it', async () => {
  const { code, out } = await run(['fix', "ModuleNotFoundError: No module named 'PIL'"])
  expect(code).toBe(0)
  expect(out.trimEnd().split('\n')).toEqual([
    '2026-10-01  app  aaaa1111',
    "  error     ModuleNotFoundError: No module named 'PIL'",
    '  then ran  pip install pillow',
    '  said      Installed pillow; the thumbnails are made now.',
  ])
})

test('fix wants most of the words of the error, and says so when nothing fits', async () => {
  expect((await run(['fix', 'ModuleNotFoundError', 'numpy', 'scipy', 'pandas'])).out).toBe('No past session got past this error.\n')
  expect((await run(['fix', 'PIL', '--exclude', A])).out).toBe('No past session got past this error.\n')
  expect(JSON.parse((await run(['fix', 'PIL', '--json'])).out).fixes[0].then[0]).toEqual({ kind: 'cmd', text: 'pip install pillow' })
  expect((await run(['fix'])).code).toBe(2)
})

test('how lists the commands that hold every word, the most run first', async () => {
  const { code, out } = await run(['how', 'make', 'thumbs'])
  expect(code).toBe(0)
  expect(out.trimEnd().split('\n')).toEqual(['2×  2026-10-01  api  python make_thumbs.py', '1×  2026-10-01  app  python make_thumbs.py --all'])
  expect((await run(['how', 'thumbs', '--project', 'api'])).out).toContain('1×')
  expect((await run(['how', 'terraform'])).out).toBe('No command on record matches.\n')
})

test('search goes on from an offset and says how many sessions are left', async () => {
  const first = await run(['search', 'make_thumbs', '--keyword', '--limit', '1'])
  expect(first.out).toContain('2 more sessions; go on with offset 1')
  const second = await run(['search', 'make_thumbs', '--keyword', '--limit', '1', '--offset', '1'])
  expect(second.out).toContain('1 more session; go on with offset 2')
  expect(second.out.slice(0, 40)).not.toBe(first.out.slice(0, 40))
  const last = await run(['search', 'make_thumbs', '--keyword', '--limit', '1', '--offset', '3'])
  expect(last.out).toBe('No more sessions match.\n')
})

test('forget removes a session, keeps it out of later index runs, and undo brings it back', async () => {
  const gone = await run(['forget', 'aaaa1'])
  expect(gone.code).toBe(0)
  expect(gone.out).toContain(A)
  expect(gone.out).toContain('5 entries')
  expect((await run(['search', 'pillow', '--keyword'])).out).toBe('No past session matches.\n')

  projects.append(join(projects.root, 'proj', `${A}.jsonl`), [userRow('pillow again please', { session: A, ts: at(30) })])
  await run(['index', '--no-embed'])
  expect((await run(['search', 'pillow', '--keyword'])).out).toBe('No past session matches.\n')
  expect((await run(['forget', '--list'])).out).toContain(A)

  expect((await run(['forget', '--undo', 'aaaa1'])).code).toBe(0)
  await run(['index', '--no-embed'])
  expect((await run(['show', A])).out).toContain('6 entries')
  expect((await run(['forget', '--list'])).out).toBe('No session is forgotten.\n')
})

test('forget refuses an id that fits several sessions or none', async () => {
  const several = await run(['forget', 'aaaa'])
  expect(several.code).toBe(1)
  expect(several.err).toContain('2 sessions')
  expect((await run(['forget', 'zzzz'])).code).toBe(1)
  expect((await run(['forget'])).code).toBe(2)
  expect((await run(['stats'])).out).toContain('sessions  3')
})

test('a secret in a transcript never reaches the index, and stats counts it', async () => {
  const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`
  projects.write('proj', 'dddd', [userRow(`use this token ${secret} for the deploy`, { session: 'dddd', ts: at(40) })])
  await run(['index', '--no-embed'])
  const { out } = await run(['show', 'dddd'])
  expect(out).toContain('[redacted:github-token]')
  expect(out).not.toContain(secret)
  expect((await run(['stats'])).out).toContain('redacted  1')
})
