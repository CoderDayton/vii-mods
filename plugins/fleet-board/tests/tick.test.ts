import { expect, test } from 'claude-code/testing'

import { exclusive } from '../src/tick'

test('a call that comes while a run is still going is skipped', async () => {
  let runs = 0
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const once = exclusive(async (_n: number) => {
    runs += 1
    await gate
  })
  const first = once(1)
  await once(2)
  release()
  await first
  await once(3)
  expect(runs).toBe(2)
})

test('a run that fails frees the next call', async () => {
  let runs = 0
  const once = exclusive(async () => {
    runs += 1
    throw new Error('boom')
  })
  await once().catch(() => undefined)
  await once().catch(() => undefined)
  expect(runs).toBe(2)
})
