import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { main } from '../../src/cli/main'
import { Projects, assistantRow, tempDir, toolRow, userRow } from './helpers'

const PARENT = 'aaaa1111-0000-0000-0000-000000000001'
const AGENT = 'af566143dcbb5ac3d'
const OTHER = 'bbbb2222-0000-0000-0000-000000000002'

let projects: Projects
let tmp: ReturnType<typeof tempDir>

const at = (minute: number): string => `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`

// A row as a sub-agent's transcript holds it: the parent's session id, and the agent's own id.
const sub = (row: string): string => JSON.stringify({ ...JSON.parse(row), isSidechain: true, agentId: AGENT })

const thinkingRow = (text: string, session: string, ts: string): string =>
  JSON.stringify({ type: 'assistant', sessionId: session, cwd: '/work/app', timestamp: ts, message: { role: 'assistant', content: [{ type: 'thinking', thinking: text, signature: 's' }] } })

beforeEach(async () => {
  projects = new Projects()
  tmp = tempDir()
  projects.write('proj', PARENT, [
    userRow('Find out why the importer drops rows', { session: PARENT, ts: at(0) }),
    thinkingRow('The importer may be skipping rows whose date is blank; a sub-agent can trace it.', PARENT, at(1)),
    assistantRow('I sent a sub-agent to trace the importer.', { session: PARENT, ts: at(2) }),
  ])
  mkdirSync(join(projects.root, 'proj', PARENT, 'subagents'), { recursive: true })
  writeFileSync(
    join(projects.root, 'proj', PARENT, 'subagents', `agent-${AGENT}.jsonl`),
    [
      sub(userRow('Trace why the importer drops rows and report the cause', { session: PARENT, ts: at(3) })),
      sub(toolRow('Edit', { file_path: '/work/app/src/importer.ts', old_string: 'if (!row.date) continue', new_string: 'if (row.date === undefined) continue' }, { session: PARENT, ts: at(4) })),
      sub(assistantRow('The importer skipped rows with an empty date string; fixed the check.', { session: PARENT, ts: at(5) })),
    ]
      .map(l => `${l}\n`)
      .join(''),
  )
  writeFileSync(join(projects.root, 'proj', PARENT, 'subagents', `agent-${AGENT}.meta.json`), '{}')
  projects.write('proj', OTHER, [userRow('The importer is fine now, thanks', { session: OTHER, ts: at(30) })])
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

test('a sub-agent run is found as its own session, and the result names the session that started it', async () => {
  const { out } = await run(['search', 'empty date string', '--keyword'])
  expect(out).toContain(`${AGENT.slice(0, 8)}  sub-agent of ${PARENT.slice(0, 8)}`)
  expect(out).toContain('The importer skipped rows with an empty date string')
})

test('a sub-agent run opens by its id and says whose it is', async () => {
  const { code, out } = await run(['show', AGENT.slice(0, 8)])
  expect(code).toBe(0)
  const lines = out.trimEnd().split('\n')
  expect(lines[0]).toContain(AGENT)
  expect(lines[0]).toContain(`sub-agent of ${PARENT}`)
  expect(lines.slice(1).map(l => l.slice(6, 15).trim())).toEqual(['user', 'edit', 'assistant'])
  expect((await run(['show', PARENT])).out).not.toContain('Trace why')
})

test('leaving a session out also leaves out the sub-agents it started', async () => {
  const { out } = await run(['search', 'importer drops rows', '--keyword', '--exclude', PARENT])
  expect(out).not.toContain(AGENT.slice(0, 8))
  expect(out).not.toContain(PARENT.slice(0, 8))
})

test('forgetting a session forgets its sub-agents, and undo brings both back', async () => {
  await run(['forget', PARENT])
  expect((await run(['search', 'importer', '--keyword'])).out).not.toContain('sub-agent')
  expect((await run(['blame', 'importer.ts'])).out).toContain('No session')
  await run(['index', '--no-embed', '--quiet'])
  expect((await run(['show', AGENT])).code).toBe(1)
  await run(['forget', '--undo', PARENT])
  await run(['index', '--no-embed', '--quiet'])
  expect((await run(['show', AGENT])).code).toBe(0)
  expect((await run(['show', PARENT])).code).toBe(0)
})

test('thinking that can be read is searched and shown as its own kind', async () => {
  const { out } = await run(['search', 'date is blank', '--keyword', '--kind', 'thinking'])
  expect(out).toContain('thinking  The importer may be skipping rows whose date is blank')
  expect((await run(['show', PARENT])).out).toContain('10:01 thinking  The importer may be')
})

test('the text of an edit is searched, shown with its file, and a sub-agent edit counts in blame', async () => {
  const { out } = await run(['search', 'row.date undefined', '--keyword', '--kind', 'edit'])
  expect(out).toContain('edit      /work/app/src/importer.ts - if (!row.date) continue + if (row.date === undefined) continue')
  const blame = await run(['blame', 'importer.ts'])
  expect(blame.out).toContain(`${AGENT.slice(0, 8)}  sub-agent of ${PARENT.slice(0, 8)}  1 edit`)
  expect(blame.out).toContain('asked   Trace why the importer drops rows')
})

test('stats counts the kinds, sub-agent runs apart from sessions', async () => {
  const { out } = await run(['stats'])
  expect(out).toContain('sessions  2')
  expect(out).toContain('agents    1')
  expect(out).toMatch(/kinds .*edit 1.*thinking 1/)
})
