import type { Holder, Snapshot } from '../types'
import { duration } from './format'
import type { Io } from './io'
import { isMine } from './messages'
import type { Config } from './options'
import { bandModel, statusLine } from './view'

const BACKGROUND_GRACE_MS = 15000
const WAIT_SLACK_MS = 2000

export type Memo = {
  previous: Snapshot | null
  backgroundSince: number | null
  lastStatus: string | undefined
}

export const newMemo = (): Memo => ({ previous: null, backgroundSince: null, lastStatus: undefined })

const showStatus = async (io: Io, config: Config, memo: Memo, snap: Snapshot, session: string) => {
  if (config.band !== 'never') return
  const model = bandModel({
    snapshot: snap,
    waiting: await io.state.waiting.get(),
    enabled: await io.state.enabled.get(),
    mode: 'auto',
    now: snap.at,
    session,
    width: 1000,
  })
  const text = statusLine(model)
  if (text === memo.lastStatus) return
  memo.lastStatus = text
  io.ui.status(text)
}

const holdersOf = (lock: Snapshot['lock']): Holder[] => {
  if (lock.kind === 'held') return lock.holder === null ? [] : [lock.holder]
  return lock.kind === 'shared' ? lock.holders : []
}

const watchBackground = (io: Io, memo: Memo, snap: Snapshot, session: string) => {
  if (memo.backgroundSince === null || snap.lock.kind !== 'free') return
  const mine = holdersOf(memo.previous?.lock ?? { kind: 'free' }).find(h => isMine(h, session))
  if (mine !== undefined) {
    io.ui.toast(`GPU free again after ${duration(snap.at - mine.since)}`)
    memo.backgroundSince = null
  } else if (snap.at - memo.backgroundSince > BACKGROUND_GRACE_MS) {
    memo.backgroundSince = null
  }
}

const releaseWait = async (io: Io, snap: Snapshot, session: string) => {
  const waiting = await io.state.waiting.get()
  if (waiting === null) return
  const started = holdersOf(snap.lock).some(h => isMine(h, session) && h.since >= waiting.since - WAIT_SLACK_MS)
  if (started) await io.state.waiting.set(() => null)
}

export const publishSnapshot = async (io: Io, config: Config, memo: Memo, snap: Snapshot) => {
  const session = await io.session.id()
  await io.state.snapshot.set(() => snap)
  await releaseWait(io, snap, session)
  watchBackground(io, memo, snap, session)
  memo.previous = snap
  await showStatus(io, config, memo, snap, session)
}
