import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { Entry } from '../../src/core/types'
import { Store } from '../../src/runtime/store/store'
import { tempDir } from './helpers'

const T0 = Date.parse('2026-10-01T10:00:00Z')

let tmp: ReturnType<typeof tempDir>
let store: Store

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({ kind: 'user', text, ts: T0, session: 'aaaa1111-x', project: '/work/app', ...extra })

beforeEach(() => {
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  tmp.remove()
})

test('sessions are found by the start of their id, newest first, with their span and size', () => {
  store.addEntries([
    entry('one', { ts: T0 }),
    entry('two', { ts: T0 + 5000, kind: 'assistant' }),
    entry('other', { session: 'aaaa2222-y', ts: T0 + 9000, project: '/work/api' }),
    entry('far', { session: 'bbbb3333-z' }),
  ])
  expect(store.sessions('aaaa')).toEqual([
    { session: 'aaaa2222-y', project: '/work/api', first: T0 + 9000, last: T0 + 9000, entries: 1 },
    { session: 'aaaa1111-x', project: '/work/app', first: T0, last: T0 + 5000, entries: 2 },
  ])
  expect(store.sessions('aaaa1111-x')).toHaveLength(1)
  expect(store.sessions('zzzz')).toEqual([])
})

test('a session prefix that holds a wildcard character is taken literally', () => {
  store.addEntries([entry('one', { session: 'a_b' }), entry('two', { session: 'axb' }), entry('three', { session: 'a%b' })])
  expect(store.sessions('a_').map(s => s.session)).toEqual(['a_b'])
  expect(store.sessions('a%').map(s => s.session)).toEqual(['a%b'])
})

test('the entries of a session come oldest first, by page and by kind', () => {
  store.addEntries([
    entry('third', { ts: T0 + 3000, kind: 'assistant' }),
    entry('first', { ts: T0 + 1000 }),
    entry('second', { ts: T0 + 2000, kind: 'cmd' }),
    entry('elsewhere', { session: 'bbbb' }),
  ])
  const texts = (options: Parameters<Store['sessionEntries']>[1]): string[] => store.sessionEntries('aaaa1111-x', options).map(e => e.text)
  expect(texts({ limit: 10, offset: 0 })).toEqual(['first', 'second', 'third'])
  expect(texts({ limit: 1, offset: 1 })).toEqual(['second'])
  expect(texts({ limit: 10, offset: 0, kinds: ['user', 'assistant'] })).toEqual(['first', 'third'])
})

test('the entries that follow one in its session come in order, of the kinds asked', () => {
  const [error] = store.addEntries([entry('ModuleNotFoundError: PIL', { ts: T0 + 1000, kind: 'error' })])
  store.addEntries([
    entry('before it', { ts: T0, kind: 'cmd' }),
    entry('pip install pillow', { ts: T0 + 2000, kind: 'cmd' }),
    entry('Installed pillow.', { ts: T0 + 3000, kind: 'assistant' }),
    entry('thanks', { ts: T0 + 4000 }),
    entry('python make.py', { ts: T0 + 5000, kind: 'cmd' }),
    entry('in another session', { ts: T0 + 2500, kind: 'cmd', session: 'bbbb' }),
  ])
  expect(store.followers(error!, ['cmd', 'assistant'], 5).map(e => e.text)).toEqual(['pip install pillow', 'Installed pillow.', 'python make.py'])
  expect(store.followers(error!, ['cmd'], 1).map(e => e.text)).toEqual(['pip install pillow'])
  expect(store.followers(99_999, ['cmd'], 5)).toEqual([])
})

test('commands that hold every word are counted, the most run first', () => {
  store.addEntries([
    entry('bun test tests/runtime', { kind: 'cmd', ts: T0 }),
    entry('bun test tests/runtime', { kind: 'cmd', ts: T0 + 9000, project: '/work/api' }),
    entry('bun test --watch', { kind: 'cmd', ts: T0 + 1000 }),
    entry('bun install', { kind: 'cmd' }),
    entry('I ran bun test for you', { kind: 'assistant' }),
  ])
  expect(store.commands(['bun', 'test'], 5, {})).toEqual([
    { text: 'bun test tests/runtime', runs: 2, last: T0 + 9000, project: '/work/api' },
    { text: 'bun test --watch', runs: 1, last: T0 + 1000, project: '/work/app' },
  ])
  expect(store.commands(['bun', 'test'], 5, { project: 'api' }).map(c => c.runs)).toEqual([1])
  expect(store.commands([], 5, {})).toEqual([])
})

test('forgetting a session removes its entries and vectors and keeps a record of it', () => {
  store.useVectors({ model: 'm', dimension: 2 })
  const ids = store.ingest('/t/a.jsonl', [entry('a secret plan for the deploy'), entry('kept', { session: 'bbbb' })], { size: 10, offset: 10 })
  store.addChunks([{ entry: ids[0]!, seq: 0, vector: [1, 0] }])
  expect(store.forget('aaaa1111-x', T0 + 1)).toBe(1)
  expect(store.sessions('aaaa')).toEqual([])
  expect(store.lexical(['secret'], 5, {})).toEqual([])
  expect(store.stats().chunks).toBe(0)
  expect(store.stats().entries).toBe(1)
  expect(store.forgotten()).toEqual([{ session: 'aaaa1111-x', project: '/work/app', at: T0 + 1 }])
})

test('a forgotten session stays out when its transcript grows', () => {
  store.ingest('/t/a.jsonl', [entry('first part')], { size: 10, offset: 10 })
  store.forget('aaaa1111-x', T0)
  store.ingest('/t/a.jsonl', [entry('second part'), entry('other session', { session: 'bbbb' })], { size: 30, offset: 30 })
  expect(store.sessions('aaaa')).toEqual([])
  expect(store.stats().entries).toBe(1)
})

test('taking a session back off the list lets its transcripts be read again from the start', () => {
  store.ingest('/t/a.jsonl', [entry('first part')], { size: 10, offset: 10 })
  store.ingest('/t/b.jsonl', [entry('unrelated', { session: 'bbbb' })], { size: 10, offset: 10 })
  store.forget('aaaa1111-x', T0)
  expect(store.unforget('aaaa1111-x')).toBe(true)
  expect(store.forgotten()).toEqual([])
  expect(store.fileState('/t/a.jsonl')).toBeNull()
  expect(store.fileState('/t/b.jsonl')).not.toBeNull()
  expect(store.unforget('aaaa1111-x')).toBe(false)
})

test('taking a session back also reads again the sub-agent transcripts that were first read while it was forgotten', () => {
  const main = '/p/app/aaaa1111-x.jsonl'
  const agent = '/p/app/aaaa1111-x/subagents/agent-1.jsonl'
  const other = '/p/app/aaaa1111-xy.jsonl'
  store.ingest(main, [entry('first part')], { size: 10, offset: 10 })
  store.forget('aaaa1111-x', T0)
  store.ingest(agent, [entry('found three callers', { session: 'agent-1', parent: 'aaaa1111-x' })], { size: 20, offset: 20 })
  store.ingest(other, [entry('unrelated', { session: 'aaaa1111-xy' })], { size: 10, offset: 10 })
  expect(store.fileState(agent)).not.toBeNull()
  store.unforget('aaaa1111-x')
  expect(store.fileState(agent)).toBeNull()
  expect(store.fileState(main)).toBeNull()
  expect(store.fileState(other)).not.toBeNull()
})

test('a forgotten session stays forgotten when the index is rebuilt under another schema version', () => {
  const path = join(tmp.path, 'index.sqlite')
  store.ingest('/t/a.jsonl', [entry('first part')], { size: 10, offset: 10 })
  store.forget('aaaa1111-x', T0)
  store.close()
  const db = new Database(path)
  db.run("update meta set value = '0' where key = 'schema'")
  db.close()
  store = Store.open(path)
  expect(store.fileState('/t/a.jsonl')).toBeNull()
  expect(store.forgotten()).toEqual([{ session: 'aaaa1111-x', project: '/work/app', at: T0 }])
})

test('the stats count the entries that had a secret cut out', () => {
  store.addEntries([entry('token is [redacted:github-token] here'), entry('nothing hidden')])
  expect(store.stats().redacted).toBe(1)
})
