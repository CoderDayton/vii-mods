import { atom, read, update } from 'claude-code'
import type { Hook, PromptComposeSection, Register } from 'claude-code'

import { parseCommand } from '../src/commands'
import { createFleet } from '../src/fleet'
import type { Fleet, Io } from '../src/fleet'
import { readOptions } from '../src/options'
import type { Config } from '../src/options'
import { bossSection, employeeSection, hireKey, parseEmployment, parseTeam, statusLine, teamKey } from '../src/team'
import type { Hire } from '../src/team'
import { exclusive } from '../src/tick'
import { asToolResult, runTool, TOOL_PREFIX, TOOL_SPECS } from '../src/tools'
import type { ToolName } from '../src/tools'
import { createTranscriptReader } from '../src/transcript'
import { paneView } from '../src/ui'
import type { Els } from '../src/ui'
import { rowsOf } from '../src/view'

const peersAtom = atom({ plugin: 'fleet-board', key: 'peers' } as const, [])
const rosterAtom = atom({ plugin: 'fleet-board', key: 'roster' } as const, {})
const notesAtom = atom({ plugin: 'fleet-board', key: 'notes' } as const, [])
const bossAtom = atom({ plugin: 'fleet-board', key: 'boss' } as const, 'boss')
const selectedAtom = atom({ plugin: 'fleet-board', key: 'selected' } as const, '')

const PANE_ID = 'fleet'
const POLL_MS = 4000
const NOTES_SHOWN = 3
const DEFAULT_COLUMNS = 100

const anyText = (text: string): boolean => text.trim() !== ''

// What the hooks give the core, set when the session starts.
type Env = {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  status: (text: string | undefined) => void
}

let io: Io | null = null
let env: Env | null = null
let fleet: Fleet | null = null
let timer: { cancel: () => void } | null = null
type Reader = ReturnType<typeof createTranscriptReader>

// The reader of the current session start. The refresh and the boss prompt read through it, so they share its cursors.
let reader: Reader | null = null

// Whether the fleet pane is open. With the pane open the tick reads the sessions even when nobody is on the team.
let paneOpen = false

let shownStatus: string | undefined

const stopPolling = (): void => {
  timer?.cancel()
  timer = null
}

let startConfig: Config | null = null

const startHook: Hook<'session.start'> = async ($, e, next) => {
  const self = await $.session.id()
  const team = parseTeam(await $.store.get(teamKey(self)))
  await update($, rosterAtom, () => team)
  // One reader per session start: its byte cursors belong to the io that uses them.
  const transcripts = createTranscriptReader(argv => $.process.run(argv).then(r => r.stdout))
  let saving: Promise<unknown> = Promise.resolve()
  reader = transcripts
  io = {
    run: (argv, init) => $.process.run(argv, init),
    send: async (id, text) => {
      const sent = await $.session.send({ to: { sessionId: id }, text })
      return sent.isDelivered ? null : sent.reason
    },
    now: () => $.clock.now(),
    selfId: () => $.session.id(),
    reply: (peer, since) => replyOf(transcripts, peer.dir, peer.id, since),
    texts: (peer, since) => transcripts.texts(peer.dir, peer.id, since),
    forget: (dir, id, since) => transcripts.forget(dir, id, since),
    prompt: text => $.prompt.submit({ text }).then(() => undefined),
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
          await update($, rosterAtom, fn)
          const save = saving.then(async () => $.store.set(teamKey(self), await read($, rosterAtom)))
          saving = save.catch(() => undefined)
          await save
        },
      },
      notes: { get: () => read($, notesAtom), set: async fn => void (await update($, notesAtom, fn)) },
      boss: { get: () => read($, bossAtom), set: async fn => void (await update($, bossAtom, fn)) },
    },
  }
  env = { every: (ms, fn) => $.clock.every(ms, fn), status: text => $.ui.status(text) }
  shownStatus = undefined
  paneOpen = false
  if (startConfig !== null) {
    fleet = createFleet(io)
    startPolling(fleet, env)
  }
  try {
    for (const spec of TOOL_SPECS) await $.tool.register(spec)
  } catch {
    $.ui.toast('fleet-board: the fleet tools could not be registered')
  }
  try {
    await $.command.register({
      name: 'fleet',
      description: 'Fleet board: the other Claude sessions and your team, in a pane',
      argumentHint: '[close]',
      immediate: true,
    })
  } catch {
    $.ui.toast('fleet-board: the /fleet command could not be registered')
  }
  return next(e)
}

// The time of the first text a session wrote at or after `since` that counts as a reply, read through `r`.
const replyOf = async (r: Reader, dir: string, id: string, since: number): Promise<number | null> =>
  (await r.texts(dir, id, since)).find(t => anyText(t.text))?.at ?? null

// Members that have not replied are read again, so the boss sees a reply before the next refresh. What is
// found here is not stored; the refresh in the pane stores it.
const withReplies = async (team: Record<string, Hire>): Promise<Record<string, Hire>> => {
  const out: Record<string, Hire> = {}
  for (const [id, hire] of Object.entries(team)) {
    const at = hire.readyAt === undefined && reader !== null ? await replyOf(reader, hire.dir, id, hire.briefedAt) : null
    out[id] = at === null ? hire : { ...hire, readyAt: at }
  }
  return out
}

const composeHook: Hook<'prompt.compose'> = async ($, e, next) => {
  const out = await next(e)
  const self = await $.session.id()
  const team = bossSection(await withReplies(parseTeam(await $.store.get(teamKey(self)))), await $.clock.now())
  const employment = parseEmployment(await $.store.get(hireKey(self)))
  const added: PromptComposeSection[] = []
  if (team !== null) added.push({ id: 'fleet-board:boss', text: team, scope: 'session' })
  if (employment !== null) added.push({ id: 'fleet-board:employee', text: employeeSection(employment), scope: 'session' })
  return { sections: [...out.sections, ...added] }
}

const showPane = async ($: Parameters<Hook<'session.start'>>[0]): Promise<void> => {
  if (fleet === null || env === null) return
  await fleet.refresh()
  await update($, selectedAtom, () => '')
  await $.ui.open({ id: PANE_ID, title: 'Fleet', closeOnEscape: true, focus: true })
  paneOpen = true
}

// Reads the sessions again every POLL_MS for as long as the session is open, so the team and the pane stay current.
const startPolling = (f: Fleet, e: Env): void => {
  stopPolling()
  timer = e.every(POLL_MS, () => {
    if (io !== null) void tick(f, io, e).catch(() => undefined)
  })
}

const showStatus = async (i: Io, e: Env): Promise<void> => {
  const text = statusLine(await i.state.roster.get())
  if (text === shownStatus) return
  shownStatus = text
  e.status(text)
}

// With the pane closed and nobody on the team there is nothing to read, so the tick skips the scan and the transcript reads.
// A tick that is still running makes the next one skip, so a slow scan cannot announce the same notice twice.
const tick = exclusive(async (f: Fleet, i: Io, e: Env): Promise<void> => {
  if (paneOpen || Object.keys(await i.state.roster.get()).length > 0) await f.refresh()
  await showStatus(i, e)
})

// A handler that throws becomes a note in the pane instead of an unhandled rejection.
const guarded = (run: (f: Fleet) => Promise<unknown>): void => {
  const f = fleet
  if (f === null) return
  void run(f).catch(() => f.note(false, 'something went wrong; try again'))
}

export const register: Register = (on, options) => {
  const config = readOptions(options)

  startConfig = config
  on('session.start', startHook)

  on('session.end', async (_$, e, next) => {
    stopPolling()
    return next(e)
  })

  on('prompt.compose', composeHook)

  // The model's fleet tools, matched by name. Each one answers with its text, and a failed one is marked as an error.
  // A throw inside a fleet tool becomes its error result, with the message (runTool), so the model reads why it failed.
  on('tool.call', async ($, e, next) => {
    const spec = TOOL_SPECS.find(s => `${TOOL_PREFIX}${s.name}` === String(e.tool))
    if (spec === undefined) return next(e)
    const f = fleet
    if (f === null) return asToolResult({ text: 'fleet-board has not started yet.', isError: true })
    const out = await runTool(spec.name as ToolName, e as unknown as Record<string, unknown>, {
      fleet: f,
      roster: () => read($, rosterAtom),
      now: () => $.clock.now(),
    })
    return asToolResult(out)
  }).catch(($, e, next) => (next.called ? next(e) : asToolResult({ text: 'fleet-board could not run the tool.', isError: true })))

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (io === null || env === null || fleet === null) return { text: 'fleet-board has not started yet.' }
    const cmd = parseCommand(e.args ?? '')
    if (cmd.kind === 'bad') return { text: cmd.text }
    if (cmd.kind === 'pane') {
      await showPane($)
      return { text: 'Fleet pane opened.' }
    }
    paneOpen = false
    await $.ui.close({ id: PANE_ID })
    return { text: 'Fleet pane closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    if (!('Input' in els)) return <els.Text>Open the fleet pane in a terminal.</els.Text>
    const peers = await read($, peersAtom)
    const roster = await read($, rosterAtom)
    const now = await $.clock.now()
    const rows = rowsOf(peers, roster, now, config.quietMs)
    const selected = await read($, selectedAtom)
    const row = rows.find(r => r.id === selected)
    const hire = roster[selected]
    return paneView(
      els as Els,
      {
        columns: e.props.bodyColumns ?? e.viewport?.columns ?? DEFAULT_COLUMNS,
        rows,
        notes: (await read($, notesAtom)).slice(-NOTES_SHOWN),
        ...(row === undefined || hire === undefined ? {} : { detail: { row, hire, now } }),
      },
      {
        onRefresh: () => guarded(f => f.refresh()),
        onClose: () => {
          paneOpen = false
          void $.ui.close({ id: PANE_ID })
        },
        onSelect: id => void update($, selectedAtom, () => id),
        onBack: () => void update($, selectedAtom, () => ''),
      },
    )
  })
}
