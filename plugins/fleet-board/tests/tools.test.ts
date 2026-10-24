import { expect, test } from 'claude-code/testing'

import type { Fleet } from '../src/fleet'
import type { Peer } from '../src/peers'
import { asToolResult, runTool } from '../src/tools'

const PEER: Peer = { id: 'q1', pid: 1, name: 'quorum-63', dir: '/p/quorum', state: 'idle', startedAt: 1, updatedAt: 1 }

const deps = (drop: () => Promise<never>) => ({
  fleet: { refresh: async () => [PEER], drop } as unknown as Fleet,
  roster: async () => ({ q1: { name: 'quorum-63', dir: '/p/quorum', role: 'research' as const, briefedAt: 1 } }),
  pool: async () => [],
  now: async () => 0,
  selfId: async () => 'me',
  selfName: async () => 'claude-mods-1c',
  employment: async () => null,
  store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
  send: async () => null,
})

// The engine takes a tool's output as a string, an array, or undefined. An object such as { content, isError } is refused.
const outputShapeOk = (result: unknown): boolean => typeof result === 'string' || Array.isArray(result) || result === undefined

test('a success is its text as the result, which the engine accepts as a string', () => {
  const out = asToolResult({ text: 'briefed quorum-63 as Research', isError: false })
  expect(out).toEqual({ result: 'briefed quorum-63 as Research' })
  expect(outputShapeOk((out as { result?: unknown }).result)).toBe(true)
})

test('an error is marked isError, with its text as the result and as the text the model reads', () => {
  expect(asToolResult({ text: 'no running session matches "nobody"', isError: true })).toEqual({
    isError: true,
    result: 'no running session matches "nobody"',
    text: 'no running session matches "nobody"',
  })
})

test('a fleet tool that throws answers with an error that names the tool and the failure', async () => {
  const out = await runTool('fleet_drop', { session: 'quorum' }, deps(async () => {
    throw new Error('the session api broke')
  }))
  expect(out).toEqual({ text: 'fleet-board could not run fleet_drop: the session api broke', isError: true })
})
