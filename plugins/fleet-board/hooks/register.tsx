import { atom, read, update } from 'claude-code'
import type { Hook, PromptComposeSection, Register } from 'claude-code'

import { parseCommand, runCommand } from '../src/commands'
import { createFleet } from '../src/fleet'
import type { Fleet, Io } from '../src/fleet'
import { readOptions } from '../src/options'
import { baseName } from '../src/peers'
import type { Peer } from '../src/peers'
import { roleOf } from '../src/roles'
import { bossSection, employeeSection, hireKey, parseEmployment, parseTeam, teamKey } from '../src/team'
import type { Hire } from '../src/team'
import { replyAfter, TAIL_ARGV } from '../src/transcript'
import { paneView } from '../src/ui'
import type { Els, PaneActions } from '../src/ui'
import { dirOptions, headline, rowsOf } from '../src/view'

const peersAtom = atom({ plugin: 'fleet-board', key: 'peers' } as const, [])
const rosterAtom = atom({ plugin: 'fleet-board', key: 'roster' } as const, {})
const notesAtom = atom({ plugin: 'fleet-board', key: 'notes' } as const, [])
const bossAtom = atom({ plugin: 'fleet-board', key: 'boss' } as const, 'boss')
const busyAtom = atom({ plugin: 'fleet-board', key: 'busy' } as const, '')
const foldersAtom = atom({ plugin: 'fleet-board', key: 'folders' } as const, [])
const formAtom = atom({ plugin: 'fleet-board', key: 'form' } as const, {
  view: 'board',
  selected: null,
  role: 'specialist',
  dir: '',
  msg: '',
  task: '',
  confirmDisband: false,
})

const PANE_ID = 'fleet'
const POLL_MS = 4000
const NOTES_SHOWN = 3
const DEFAULT_COLUMNS = 100

// What the hooks give the core, set when the session starts.
type Env = {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  hasPane: () => Promise<boolean>
}

let io: Io | null = null
let env: Env | null = null
let fleet: Fleet | null = null
let timer: { cancel: () => void } | null = null

const stopPolling = (): void => {
  timer?.cancel()
  timer = null
}

const startHook: Hook<'session.start'> = async ($, e, next) => {
  const self = await $.session.id()
  const team = parseTeam(await $.store.get(teamKey(self)))
  await update($, rosterAtom, () => team)
  io = {
    run: (argv, init) => $.process.run(argv, init),
    send: async (id, text) => {
      const sent = await $.session.send({ to: { sessionId: id }, text })
      return sent.isDelivered ? null : sent.reason
    },
    now: () => $.clock.now(),
    sleep: ms => $.clock.sleep(ms),
    exists: path => $.fs.exists(path),
    selfId: () => $.session.id(),
    reply: (peer, since) => replyOf($, peer.dir, peer.id, since),
    store: {
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
    },
    state: {
      peers: { get: () => read($, peersAtom), set: async fn => void (await update($, peersAtom, fn)) },
      // The team is kept in the store as well as the atom, so a restarted boss has it again.
      roster: {
        get: () => read($, rosterAtom),
        set: async fn => {
          const updated = fn(await read($, rosterAtom))
          await update($, rosterAtom, () => updated)
          await $.store.set(teamKey(self), updated)
        },
      },
      notes: { get: () => read($, notesAtom), set: async fn => void (await update($, notesAtom, fn)) },
      boss: { get: () => read($, bossAtom), set: async fn => void (await update($, bossAtom, fn)) },
    },
  }
  env = {
    every: (ms, fn) => $.clock.every(ms, fn),
    hasPane: async () => (await $.ui.panes()).some(pane => pane.id === PANE_ID),
  }
  try {
    await $.command.register({
      name: 'fleet',
      description: 'Fleet board: the other Claude sessions, with ping, brief, task, stop, drop and new session',
      argumentHint: '[list|ping|brief|task|stop|drop|new|disband|close]',
      immediate: true,
    })
  } catch {
    $.ui.toast('fleet-board: the /fleet command could not be registered')
  }
  return next(e)
}

// What the system prompt says about the fleet: a boss is told its team, an employee is told its boss.
type Engine = Parameters<Hook<'session.start'>>[0]

// The time of the first reply a session wrote at or after `since`, read from the end of its transcript.
const replyOf = async ($: Engine, dir: string, id: string, since: number): Promise<number | null> => {
  if (dir === '') return null
  const tail = await $.process.run(TAIL_ARGV(dir, id))
  return replyAfter(tail.stdout, since)
}

// Members that have not replied are read again, so the boss sees a reply before the next refresh. What is
// found here is not stored; the refresh in the pane stores it.
const withReplies = async ($: Engine, team: Record<string, Hire>): Promise<Record<string, Hire>> => {
  const out: Record<string, Hire> = {}
  for (const [id, hire] of Object.entries(team)) {
    const at = hire.readyAt === undefined ? await replyOf($, hire.dir, id, hire.briefedAt) : null
    out[id] = at === null ? hire : { ...hire, readyAt: at }
  }
  return out
}

const composeHook: Hook<'prompt.compose'> = async ($, e, next) => {
  const out = await next(e)
  const self = await $.session.id()
  const team = bossSection(await withReplies($, parseTeam(await $.store.get(teamKey(self)))))
  const employment = parseEmployment(await $.store.get(hireKey(self)))
  const added: PromptComposeSection[] = []
  if (team !== null) added.push({ id: 'fleet-board:boss', text: team, scope: 'session' })
  if (employment !== null) added.push({ id: 'fleet-board:employee', text: employeeSection(employment), scope: 'session' })
  return { sections: [...out.sections, ...added] }
}

// Subfolders of the project's parent, which is where the person's other projects usually live.
const siblingsOf = async ($: Parameters<Hook<'session.start'>>[0], root: string): Promise<string[]> => {
  const parent = root.replace(/\/[^/]*$/, '') || '/'
  try {
    const entries = await $.fs.list(parent)
    return entries
      .filter(e => e.kind === 'dir' && !e.name.startsWith('.'))
      .map(e => `${parent === '/' ? '' : parent}/${e.name}`)
      .sort()
  } catch {
    return []
  }
}

const showPane = async ($: Parameters<Hook<'session.start'>>[0]): Promise<void> => {
  if (fleet === null || env === null) return
  const root = await $.session.root()
  await update($, formAtom, f => ({ ...f, dir: f.dir === '' ? root : f.dir }))
  await update($, foldersAtom, () => [])
  await fleet.refresh()
  await $.ui.open({ id: PANE_ID, title: 'Fleet', closeOnEscape: true, focus: true })
  void siblingsOf($, root).then(list => update($, foldersAtom, () => list))
  startPolling(fleet, env)
}

// Reads the sessions again while the pane is open, and stops once it is closed.
const startPolling = (f: Fleet, e: Env): void => {
  stopPolling()
  timer = e.every(POLL_MS, () => {
    void e.hasPane().then(async isOpen => {
      if (isOpen) await f.refresh()
      else stopPolling()
    })
  })
}

// A handler that throws becomes a note in the pane instead of an unhandled rejection.
const guarded = (run: (f: Fleet) => Promise<unknown>): void => {
  const f = fleet
  if (f === null) return
  void run(f).catch(() => f.note(false, 'something went wrong; try again'))
}

export const register: Register = (on, options) => {
  const config = readOptions(options)

  on('session.start', startHook)

  on('session.end', async (_$, e, next) => {
    stopPolling()
    return next(e)
  })

  on('prompt.compose', composeHook)

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (io === null || env === null) return { text: 'fleet-board has not started yet.' }
    fleet ??= createFleet(io, config)
    const cmd = parseCommand(e.args ?? '')
    const ctx = { roster: await read($, rosterAtom), now: await $.clock.now(), quietMs: config.quietMs }
    const out = await runCommand(cmd, fleet, ctx)
    if (out.action === 'pane') {
      await showPane($)
      return { text: 'Fleet pane opened.' }
    }
    if (out.action === 'close') {
      stopPolling()
      await $.ui.close({ id: PANE_ID })
      return { text: 'Fleet pane closed.' }
    }
    return { text: out.text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    if (!('Input' in els)) return <els.Text>Open the fleet pane in a terminal.</els.Text>
    const peers = await read($, peersAtom)
    const roster = await read($, rosterAtom)
    const form = await read($, formAtom)
    const rows = rowsOf(peers, roster, await $.clock.now(), config.quietMs)
    const picked = (): Peer | undefined => peers.find(p => p.id === form.selected)
    const needPick = (f: Fleet) => f.note(false, 'pick a session first')
    const setForm = (patch: Partial<typeof form>) => update($, formAtom, f => ({ ...f, ...patch }))

    const actions: PaneActions = {
      onPick: id => void setForm({ selected: id, msg: '', confirmDisband: false }),
      onPing: () => guarded(async f => (picked() ? f.ping(picked()!) : needPick(f))),
      onBrief: () => guarded(async f => (picked() ? f.brief(picked()!, roleOf(form.role)!) : needPick(f))),
      onStop: () => guarded(async f => (picked() ? f.stop(picked()!) : needPick(f))),
      onDrop: () => guarded(async f => (picked() ? f.drop(picked()!) : needPick(f))),
      onPingTeam: () => guarded(f => f.pingTeam()),
      // Disbanding tells every employee, so the first press only asks for the second.
      onDisband: () => {
        if (!form.confirmDisband) return void setForm({ confirmDisband: true })
        void setForm({ confirmDisband: false })
        guarded(f => f.disband())
      },
      onRefresh: () => guarded(f => f.refresh()),
      onClose: () => {
        stopPolling()
        void $.ui.close({ id: PANE_ID })
      },
      onNew: () => void setForm({ view: 'new' }),
      onBack: () => void setForm({ view: 'board', confirmDisband: false }),
      onRole: id => void setForm({ role: roleOf(id)?.id ?? form.role }),
      onDir: dir => void setForm({ dir }),
      onMsg: msg => void setForm({ msg }),
      onTask: task => void setForm({ task }),
      onSend: text =>
        guarded(async f => {
          const peer = picked()
          if (peer === undefined) return needPick(f)
          const sent = await f.task(peer, text)
          if (sent.ok) await setForm({ msg: '' })
          return sent
        }),
      onOpen: text =>
        guarded(async f => {
          const role = roleOf(form.role)
          if (role === undefined || form.dir === '') return f.note(false, 'pick a folder first')
          await update($, busyAtom, () => `opening a session in ${baseName(form.dir)}`)
          try {
            const opened = await f.open({ dir: form.dir, role, task: text })
            if (opened.ok) await setForm({ view: 'board', task: '' })
            return opened
          } finally {
            await update($, busyAtom, () => '')
          }
        }),
    }

    const folders = await read($, foldersAtom)
    return paneView(els as Els, {
      columns: e.props.bodyColumns ?? e.viewport?.columns ?? DEFAULT_COLUMNS,
      headline: headline(rows),
      rows,
      selected: rows.find(r => r.id === form.selected) ?? null,
      view: form.view,
      role: form.role,
      dirs: dirOptions(form.dir, peers, folders),
      dir: form.dir,
      msg: form.msg,
      task: form.task,
      notes: (await read($, notesAtom)).slice(-NOTES_SHOWN),
      busy: await read($, busyAtom),
      confirmDisband: form.confirmDisband,
    }, actions)
  })
}
