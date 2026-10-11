import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { main } from '../../src/cli/main'
import { Projects, assistantRow, commandRow, errorRow, tempDir, toolRow, userRow } from './helpers'

const TALK = 'aaaa1111-0000-0000-0000-000000000001'
const FIXED = 'bbbb2222-0000-0000-0000-000000000002'
const TEAM = 'cccc3333-0000-0000-0000-000000000003'
const PIL = "Traceback (most recent call last):\nModuleNotFoundError: No module named 'PIL'"

let projects: Projects
let tmp: ReturnType<typeof tempDir>

const at = (minute: number): string => `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`

const peerRow = (text: string, session: string, ts: string): string =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    origin: { kind: 'peer', from: 'uds:/x.sock' },
    sessionId: session,
    cwd: '/work/app',
    timestamp: ts,
    message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from="uds:/x.sock" from-name="boss">\n${text}\n</cross-session-message>` },
  })

beforeEach(async () => {
  projects = new Projects()
  tmp = tempDir()
  projects.write('app', TALK, [
    userRow('Make the thumbnails', { session: TALK, ts: at(0) }),
    errorRow(PIL, { session: TALK, ts: at(1) }),
    assistantRow('PIL is the import name of Pillow, which is not installed here.', { session: TALK, ts: at(2) }),
  ])
  projects.write('app', FIXED, [
    userRow('Make the thumbnails for the gallery', { session: FIXED, ts: at(10) }),
    errorRow(PIL, { session: FIXED, ts: at(11) }),
    assistantRow('Pillow is missing. I will add it to the requirements.', { session: FIXED, ts: at(12) }),
    toolRow('Edit', { file_path: '/work/app/requirements.txt', old_string: 'requests', new_string: 'requests\npillow' }, { session: FIXED, ts: at(13) }),
    commandRow('pip install -r requirements.txt', { session: FIXED, ts: at(14) }),
    assistantRow('Pillow is in the requirements and installed; the gallery thumbnails are made.', { session: FIXED, ts: at(15) }),
    userRow('good, commit it', { session: FIXED, ts: at(16) }),
    assistantRow('Committed as 1a2b3c4.', { session: FIXED, ts: at(17) }),
  ])
  projects.write('app', TEAM, [
    peerRow('Task from boss: remove the launcher option and its README lines.', TEAM, at(30)),
    commandRow('rg -n launcher README.md src', { session: TEAM, ts: at(31) }),
    assistantRow('The launcher option is gone from the code and the README.', { session: TEAM, ts: at(32) }),
  ])
  await run(['index', '--no-embed', '--quiet'])
})

afterEach(() => {
  projects.remove()
  tmp.remove()
})

const env = () => ({ HOME: tmp.path, LOOKBACK_PROJECTS: projects.root, LOOKBACK_DB: join(tmp.path, 'index.sqlite'), LOOKBACK_EMBEDDING_URL: 'http://127.0.0.1:1/v1' })

async function run(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, { env: env(), stdout: t => out.push(t), stderr: t => err.push(t), now: () => Date.parse('2026-10-11T00:00:00Z') })
  return { code, out: out.join(''), err: err.join('') }
}

test('a search shows a match inside its turn, down to what the user said next', async () => {
  const { out } = await run(['search', 'pip install requirements', '--keyword', '--kind', 'cmd'])
  expect(out.trimEnd().split('\n')).toEqual([
    '2026-10-01  app  bbbb2222',
    '  changed   app/requirements.txt',
    '  asked     Make the thumbnails for the gallery',
    '  cmd       pip install -r requirements.txt',
    '  ended     Pillow is in the requirements and installed; the gallery thumbnails are made.',
    '  reply     good, commit it',
  ])
})

test('a task another session sent is the prompt of the work it started', async () => {
  const { out } = await run(['search', 'rg launcher README', '--keyword', '--kind', 'cmd'])
  expect(out).toContain('  asked     Task from boss: remove the launcher option and its README lines.')
  expect(out).not.toContain('cross-session-message')
})

test('fix leaves out a session that only talked about the error, and shows how the other one ended', async () => {
  const { out } = await run(['fix', "ModuleNotFoundError: No module named 'PIL'"])
  expect(out.trimEnd().split('\n')).toEqual([
    '2026-10-01  app  bbbb2222',
    "  error     ModuleNotFoundError: No module named 'PIL'",
    '  changed   /work/app/requirements.txt - requests + requests pillow',
    '  then ran  pip install -r requirements.txt',
    '  said      Pillow is in the requirements and installed; the gallery thumbnails are made.',
  ])
})

test('fix does not take an error for another one that shares only its common words', async () => {
  expect((await run(['fix', "ModuleNotFoundError: No module named 'numpy'"])).out).toBe('No past session got past this error.\n')
})

test('show counts only the kinds asked for, and says so past the last one', async () => {
  expect((await run(['show', FIXED, '--kind', 'user', '--kind', 'assistant', '--offset', '2', '--limit', '1'])).out).toContain('entries 3 to 3 of 5; go on with offset 3')
  expect((await run(['show', FIXED, '--kind', 'user', '--offset', '9'])).out.trimEnd().split('\n').at(-1)).toBe('… no entries past 2')
})
