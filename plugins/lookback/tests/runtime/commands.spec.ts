import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { main } from '../../src/cli/main'
import { Projects, assistantRow, commandRow, errorRow, tempDir, toolRow, userRow } from './helpers'

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

test('recall prints nothing when the index holds no vectors, and needs a prompt', async () => {
  const none = await run(['recall', '--project', '/work', '--', 'make the thumbnails for the gallery again please'])
  expect(none).toEqual({ code: 0, out: '', err: '' })
  expect((await run(['recall'])).code).toBe(2)
})

const D = 'dddd4444-0000-0000-0000-000000000004'

// Enough other entries that a word of the test is not a common one, then a session the index has not read:
// an early turn, a compaction, and the exchange before the question.
const writeCompacted = async (): Promise<void> => {
  projects.write(
    'proj',
    'filler',
    Array.from({ length: 300 }, (_, i) => userRow(`Unrelated note number ${i} about something else`, { session: 'filler', ts: at(5) })),
  )
  await run(['index', '--no-embed'])
  projects.write('proj', D, [
    userRow('Make the gallery thumbnails with pillow', { session: D, ts: at(30) }),
    assistantRow('Rebuilt the gallery thumbnails with pillow, all 40 of them.', { session: D, ts: at(31) }),
    JSON.stringify({ type: 'user', sessionId: D, cwd: '/work/app', timestamp: at(40), isCompactSummary: true, message: { role: 'user', content: 'This session is being continued.' } }),
    userRow('now check the gallery thumbnails', { session: D, ts: at(41) }),
    assistantRow('The gallery thumbnails are sharp, and pillow wrote each one.', { session: D, ts: at(42) }),
  ])
}

test('recall --asked reads the new turns of the session asking and answers from its earlier ones', async () => {
  await writeCompacted()
  projects.write('proj', 'unread', [userRow('a zebracrossing remark', { session: 'unread' })])
  const { code, out } = await run(['recall', '--asked', '--session', D, '--', 'did you rebuild it?'])
  expect(code).toBe(0)
  expect(out).toContain('dddd4444  this session, earlier')
  expect(out).toContain('Rebuilt the gallery thumbnails with pillow')
  expect(out).not.toContain('are sharp')
  expect((await run(['search', '--keyword', 'zebracrossing'])).out).toContain('No past session matches.')
})

test('search --own reads the new turns of a session and finds its earlier ones, but not the turn it is in', async () => {
  await writeCompacted()
  const early = await run(['search', '--keyword', '--own', D, '--', 'rebuilt gallery thumbnails pillow'])
  expect(early.out).toContain('dddd4444  this session, earlier')
  expect(early.out).toContain('Rebuilt the gallery thumbnails with pillow')
  expect(early.out).not.toContain('are sharp')
  expect((await run(['search', '--keyword', '--own', D, '--', 'sharp'])).out).toContain('No past session matches.')
  expect((await run(['search', '--keyword', '--exclude', D, '--', 'rebuilt gallery pillow'])).out).not.toContain('dddd4444')
  expect((await run(['search', '--own', D, '--exclude', D, '--', 'x'])).code).toBe(2)
})

test('recall --asked prints nothing when nothing is on topic, and needs a session', async () => {
  await writeCompacted()
  expect(await run(['recall', '--asked', '--session', C, '--', 'did you rebuild it?'])).toEqual({ code: 0, out: '', err: '' })
  expect((await run(['recall', '--asked', '--', 'did you rebuild it?'])).code).toBe(2)
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

const titleRow = (session: string, aiTitle: string): string => JSON.stringify({ type: 'ai-title', aiTitle, sessionId: session })

test('recent lists the latest sessions of a folder, newest first, by title or else by first prompt', async () => {
  projects.write('proj', 'titles', [titleRow(A, 'Gallery thumbnails')])
  await run(['index', '--no-embed'])
  const { code, out } = await run(['recent', '--project', '/work/app'])
  expect(code).toBe(0)
  expect(out).toBe('2026-10-01  app  cccc3333  Rename the config loader\n2026-10-01  app  aaaa1111  Gallery thumbnails\n  ended     Installed pillow; the thumbnails are made now.\n')
  expect((await run(['recent', '--project', '/work/app', '--exclude', C, '--limit', '1'])).out).toBe('2026-10-01  app  aaaa1111  Gallery thumbnails\n  ended     Installed pillow; the thumbnails are made now.\n')
  expect((await run(['recent', '--project', '/work', '--exact'])).out).toBe('')
  expect((await run(['recent', '--project', '/work/none'])).out).toBe('')
  expect((await run(['recent'])).out.trimEnd().split('\n').filter(l => !l.startsWith(' '))).toHaveLength(3)
  expect(JSON.parse((await run(['recent', '--project', '/work/api', '--json'])).out)).toEqual([
    { session: B, project: '/work/api', last: Date.parse(at(12)), title: null, asked: 'Run the thumbnails again', ended: null },
  ])
})

test('blame --brief says in a few lines who changed a file, and nothing when too few sessions did', async () => {
  const E1 = 'eeee5555-0000-0000-0000-000000000005'
  const E2 = 'ffff6666-0000-0000-0000-000000000006'
  const edit = (session: string, minute: number) => toolRow('Edit', { file_path: '/work/app/src/a.ts', old_string: 'x', new_string: 'y' }, { session, ts: at(minute) })
  projects.write('proj', E1, [userRow('Widen the pane', { session: E1, ts: at(30) }), edit(E1, 31)])
  projects.write('proj', E2, [userRow('Rename the flag', { session: E2, ts: at(40) }), edit(E2, 41)])
  await run(['index', '--no-embed'])

  const note = await run(['blame', '--brief', '--min', '2', '--', '/work/app/src/a.ts'])
  expect(note.out).toBe('Changed in 2 earlier sessions; the latest:\n  2026-10-01  ffff6666  Rename the flag\n  2026-10-01  eeee5555  Widen the pane\n')
  expect((await run(['blame', '--brief', '--min', '3', '--', '/work/app/src/a.ts'])).out).toBe('')
  expect((await run(['blame', '--brief', '--min', '2', '--exclude', E2, '--', '/work/app/src/a.ts'])).out).toBe('')
  expect((await run(['blame', '--brief', '--min', '1', '--', '/work/app/src/nothing.ts'])).out).toBe('')
})

test('blame with a folder reads a path as one file of that folder, however a session spelled it', async () => {
  const ids = ['eeee5555-0000-0000-0000-000000000005', 'ffff6666-0000-0000-0000-000000000006', 'abab7777-0000-0000-0000-000000000007', 'cdcd8888-0000-0000-0000-000000000008']
  const edit = (i: number, path: string, cwd: string) => projects.write('proj', ids[i]!, [toolRow('Edit', { file_path: path, old_string: 'x', new_string: 'y' }, { session: ids[i]!, cwd, ts: at(30 + i) })])
  edit(0, '/work/app/src/a.ts', '/work/app')
  edit(1, './src/a.ts', '/work/app')
  edit(2, '/work/api/src/a.ts', '/work/api')
  edit(3, 'src/a.ts', '/work/api')
  await run(['index', '--no-embed'])

  const head = async (argv: string[]) => (await run(['blame', '--brief', '--min', '1', ...argv])).out.split('\n').slice(0, 3)
  const mine = ['Changed in 2 earlier sessions; the latest:', '  2026-10-01  ffff6666', '  2026-10-01  eeee5555']
  expect(await head(['--project', '/work/app', '--', 'src/a.ts'])).toEqual(mine)
  expect(await head(['--project', '/work/api', '--', '/work/app/src/a.ts'])).toEqual(mine)
  expect(await head(['--project', '/work/api', '--', './src/a.ts'])).toEqual(['Changed in 2 earlier sessions; the latest:', '  2026-10-01  cdcd8888', '  2026-10-01  abab7777'])
  expect((await head(['--', 'src/a.ts']))[0]).toBe('Changed in 4 earlier sessions; the latest:')
})

test('a search result names the session by its title', async () => {
  projects.write('proj', 'titles', [titleRow(A, 'Gallery thumbnails')])
  await run(['index', '--no-embed'])
  const { out } = await run(['search', 'pillow', '--keyword'])
  expect(out.split('\n')[0]).toBe('2026-10-01  app  aaaa1111  Gallery thumbnails')
})
