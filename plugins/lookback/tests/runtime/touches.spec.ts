import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { main } from '../../src/cli/main'
import { Projects, assistantRow, tempDir, toolRow, userRow } from './helpers'

const A = 'aaaa1111-0000-0000-0000-000000000001'
const B = 'bbbb2222-0000-0000-0000-000000000002'
const EDIT = 'mcp__semantic-cache-mcp__edit'
const READ = 'mcp__semantic-cache-mcp__read'

let projects: Projects
let tmp: ReturnType<typeof tempDir>
let fileTools: string | undefined

const at = (minute: number): string => `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`

beforeEach(() => {
  projects = new Projects()
  tmp = tempDir()
  fileTools = 'mcp__semantic-cache-mcp'
  projects.write('proj', A, [
    userRow('Make the store reject a second writer', { session: A, ts: at(0) }),
    toolRow(READ, { path: '/work/app/src/store.ts' }, { session: A, ts: at(1) }),
    toolRow(EDIT, { path: '/work/app/src/store.ts', old_string: 'a', new_string: 'b' }, { session: A, ts: at(2) }),
    toolRow(EDIT, { path: '/work/app/src/store.ts', old_string: 'b', new_string: 'c' }, { session: A, ts: at(3) }),
    userRow('Now add a test for it', { session: A, ts: at(4) }),
    toolRow('Write', { file_path: '/work/app/tests/store.spec.ts', content: '' }, { session: A, ts: at(5) }),
    assistantRow('The store rejects a second writer now.', { session: A, ts: at(6) }),
  ])
  projects.write('proj', B, [
    userRow('Why is the store slow?', { session: B, cwd: '/work/api', ts: at(20) }),
    toolRow(READ, { path: '/work/app/src/store.ts' }, { session: B, cwd: '/work/api', ts: at(21) }),
    toolRow(EDIT, { path: '/work/api/src/restore.ts', old_string: 'a', new_string: 'b' }, { session: B, cwd: '/work/api', ts: at(22) }),
  ])
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
  LOOKBACK_FILE_TOOLS: fileTools,
})

const run = async (argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, { env: env(), stdout: t => out.push(t), stderr: t => err.push(t), now: () => Date.parse('2026-10-11T00:00:00Z') })
  return { code, out: out.join(''), err: err.join('') }
}

const index = () => run(['index', '--no-embed', '--quiet'])

test('blame lists the sessions that changed a file, with what was asked before the change', async () => {
  await index()
  const { code, out } = await run(['blame', 'src/store.ts'])
  expect(code).toBe(0)
  expect(out.trimEnd().split('\n')).toEqual(['/work/app/src/store.ts', '  2026-10-01  app  aaaa1111  2 edits, 1 read', '    asked   Make the store reject a second writer'])
})

test('blame matches whole path parts from the end, and can include sessions that only read', async () => {
  await index()
  expect((await run(['blame', 'store.ts'])).out).not.toContain('restore.ts')
  expect((await run(['blame', '/work/app/src/store.ts'])).out).toContain('aaaa1111')
  const reads = await run(['blame', 'store.ts', '--reads'])
  expect(reads.out).toContain('bbbb2222  1 read')
  expect(reads.out).toContain('Why is the store slow?')
  expect((await run(['blame', 'nothing.ts'])).out).toBe('No session on record touched a file that ends with "nothing.ts".\n')
  expect((await run(['blame'])).code).toBe(2)
})

test('files lists what a session touched, the most changed first', async () => {
  await index()
  const { code, out } = await run(['files', 'aaaa1'])
  expect(code).toBe(0)
  expect(out.trimEnd().split('\n')).toEqual([`${A}  app  2026-10-01  5 entries`, '  2 edits, 1 read  /work/app/src/store.ts', '  1 edit           /work/app/tests/store.spec.ts'])
  expect((await run(['files', 'zzzz'])).code).toBe(1)
})

test('without the setting, MCP tools are not recorded and built-in tools are', async () => {
  fileTools = undefined
  await index()
  expect((await run(['blame', 'store.ts', '--reads'])).out).toContain('No session')
  expect((await run(['blame', 'store.spec.ts'])).out).toContain('aaaa1111  1 edit')
})

test('a changed setting reads the transcripts again for files and edits, and leaves the other entries alone', async () => {
  fileTools = undefined
  await index()
  const before = (await run(['stats'])).out
  fileTools = 'mcp__semantic-cache-mcp__edit'
  const again = await index()
  expect(again.code).toBe(0)
  expect((await run(['blame', 'src/store.ts'])).out).toContain('aaaa1111  2 edits')
  expect((await run(['blame', 'src/store.ts', '--reads'])).out).not.toContain('bbbb2222')
  const after = (await run(['stats'])).out
  expect(before).toContain('kinds     assistant 1, user 3')
  expect(after).toContain('kinds     assistant 1, edit 3, user 3')
  fileTools = ''
  await index()
  expect((await run(['stats'])).out).toContain('kinds     assistant 1, user 3')
  expect(after).toContain('files     3')
})

test('an index run that names no setting keeps the one the index was built under', async () => {
  await index()
  const built = (await run(['stats'])).out
  fileTools = undefined
  await index()
  expect((await run(['stats'])).out).toBe(built)
  expect((await run(['blame', 'src/store.ts'])).out).toContain('aaaa1111')
})

test('new lines of a transcript add their files once, and forgetting a session removes them', async () => {
  await index()
  projects.append(join(projects.root, 'proj', `${A}.jsonl`), [toolRow(EDIT, { path: '/work/app/src/store.ts', old_string: 'c', new_string: 'd' }, { session: A, ts: at(7) })])
  await index()
  expect((await run(['blame', 'src/store.ts'])).out).toContain('3 edits, 1 read')
  await run(['forget', 'aaaa1'])
  expect((await run(['blame', 'src/store.ts', '--reads'])).out).not.toContain('aaaa1111')
  expect((await run(['blame', 'src/store.ts', '--reads'])).out).toContain('bbbb2222')
})

test('when more sessions changed matching files than the limit, blame keeps the latest', async () => {
  projects.append(join(projects.root, 'proj', `${B}.jsonl`), [toolRow(EDIT, { path: '/work/zeta/src/store.ts', old_string: 'a', new_string: 'b' }, { session: B, cwd: '/work/api', ts: at(23) })])
  await index()
  const { out } = await run(['blame', 'src/store.ts', '--limit', '1'])
  expect(out).toContain('/work/zeta/src/store.ts')
  expect(out).not.toContain('aaaa1111')
})
