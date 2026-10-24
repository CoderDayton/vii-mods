import { atom, read, update } from 'claude-code'
import type { Hook, PromptComposeSection, Register } from 'claude-code'

import { parseCommand } from '../src/commands'
import { boardLines, moveSession, postsOf, publishedFile, teamDir, teamFile } from '../src/crew'
import type { Store } from '../src/crew'
import { createFleet } from '../src/fleet'
import type { Box, Fleet, Io } from '../src/fleet'
import { readOptions } from '../src/options'
import type { Config } from '../src/options'
import { bossSection, employeeSection, hireKey, parseEmployment, parsePool, parseTeam, poolKey, statusLine, teamKey } from '../src/team'
import type { Hire } from '../src/team'
import { exclusive } from '../src/tick'
import { asToolResult, runTool, TOOL_PREFIX, TOOL_SPECS } from '../src/tools'
import type { ToolDeps, ToolName } from '../src/tools'
import { paneAction, runBoss } from '../src/boss'
import { createTranscriptReader } from '../src/transcript'
import { paneView } from '../src/ui'
import type { Els } from '../src/ui'
import { rowsOf } from '../src/view'

const peersAtom = atom({ plugin: 'fleet-board', key: 'peers' } as const, [])
const rosterAtom = atom({ plugin: 'fleet-board', key: 'roster' } as const, {})
const poolAtom = atom({ plugin: 'fleet-board', key: 'pool' } as const, [])
const notesAtom = atom({ plugin: 'fleet-board', key: 'notes' } as const, [])
const bossAtom = atom({ plugin: 'fleet-board', key: 'boss' } as const, 'boss')
const selectedAtom = atom({ plugin: 'fleet-board', key: 'selected' } as const, '')
const clearedAtom = atom({ plugin: 'fleet-board', key: 'cleared' } as const, '')

const PANE_ID = 'fleet'
const POLL_MS = 4000
const NOTES_SHOWN = 5
const DEFAULT_COLUMNS = 100

const anyText = (text: string): boolean => text.trim() !== ''

// What the hooks give the core, set when the session starts.
type Env = {
  own: () => Promise<string>
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

let outbox: string[] = []
let unsent = false
let submit: ((text: string) => Promise<unknown>) | null = null
let filesDir = teamDir(undefined, undefined)

const stopPolling = (): void => {
  timer?.cancel()
  timer = null
}

let startConfig: Config | null = null

const kept = <T,>(get: () => Promise<T>, change: (fn: (v: T) => T) => Promise<unknown>, save: (v: T) => Promise<void>): Box<T> => {
  let saving: Promise<unknown> = Promise.resolve()
  return {
    get,
    set: async fn => {
      await change(fn)
      const next = saving.then(async () => save(await get()))
      saving = next.catch(() => undefined)
      await next
    },
  }
}

const storeOf = ($: Parameters<Hook<'session.start'>>[0]): Store => ({
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: key => $.store.delete(key),
  keys: () => $.store.keys(),
})

const sendOf =
  ($: Parameters<Hook<'session.start'>>[0]) =>
  async (id: string, text: string): Promise<string | null> => {
    const sent = await $.session.send({ to: { sessionId: id }, text })
    return sent.isDelivered ? null : sent.reason
  }

let moving: Promise<unknown> = Promise.resolve()

const owned = ($: Parameters<Hook<'session.start'>>[0]): Promise<string> => {
  const run = moving.then(async () => {
    const id = await $.session.id()
    const was = await read($, clearedAtom)
    if (was === '' || was === id) return id
    await moveSession(storeOf($), was, id)
    await update($, clearedAtom, () => '')
    return id
  })
  moving = run.catch(() => undefined)
  return run
}

const startHook: Hook<'session.start'> = async ($, e, next) => {
  const self = await owned($)
  filesDir = teamDir(await $.env.get('XDG_RUNTIME_DIR'), await $.env.get('HOME'))
  const team = parseTeam(await $.store.get(teamKey(self)))
  await update($, rosterAtom, () => team)
  const pool = parsePool(await $.store.get(poolKey(self)))
  await update($, poolAtom, () => pool)
  // One reader per session start: its byte cursors belong to the io that uses them.
  const transcripts = createTranscriptReader(argv => $.process.run(argv).then(r => r.stdout))
  reader = transcripts
  io = {
    run: (argv, init) => $.process.run(argv, init),
    send: sendOf($),
    now: () => $.clock.now(),
    selfId: () => $.session.id(),
    reply: (peer, since) => replyOf(transcripts, peer.dir, peer.id, since),
    texts: (peer, since) => transcripts.texts(peer.dir, peer.id, since),
    forget: (dir, id, since) => transcripts.forget(dir, id, since),
    prompt: async text => void outbox.push(text),
    store: storeOf($),
    writeFile: (path, text) => $.fs.write(path, text),
    teamDir: filesDir,
    state: {
      peers: { get: () => read($, peersAtom), set: async fn => void (await update($, peersAtom, fn)) },
      roster: kept(() => read($, rosterAtom), fn => update($, rosterAtom, fn), async v => $.store.set(teamKey(await owned($)), v)),
      pool: kept(() => read($, poolAtom), fn => update($, poolAtom, fn), async v => $.store.set(poolKey(await owned($)), v)),
      notes: { get: () => read($, notesAtom), set: async fn => void (await update($, notesAtom, fn)) },
      boss: { get: () => read($, bossAtom), set: async fn => void (await update($, bossAtom, fn)) },
    },
  }
  env = { own: () => owned($), every: (ms, fn) => $.clock.every(ms, fn), status: text => $.ui.status(text) }
  submit = text => $.prompt.submit({ text })
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
      argumentHint: '[init|close]',
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
  const self = await owned($)
  const now = await $.clock.now()
  const store = storeOf($)
  const roster = await withReplies(parseTeam(await $.store.get(teamKey(self))))
  const board = Object.keys(roster).length === 0 ? [] : boardLines(self, roster, await postsOf(store, self), now)
  const team = bossSection(roster, now, parsePool(await $.store.get(poolKey(self))), { board, file: teamFile(filesDir, self) })
  const employment = parseEmployment(await $.store.get(hireKey(self)))
  const added: PromptComposeSection[] = []
  if (team !== null) added.push({ id: 'fleet-board:boss', text: team, scope: 'session' })
  if (employment !== null) {
    const crewTeam = parseTeam(await $.store.get(teamKey(employment.bossId)))
    const crew = { self, team: crewTeam, board: boardLines(employment.bossId, crewTeam, await postsOf(store, employment.bossId), now, self), file: await publishedFile(store, employment.bossId, teamFile(filesDir, employment.bossId)) }
    added.push({ id: 'fleet-board:employee', text: employeeSection(employment, crew), scope: 'session' })
  }
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
  const text = statusLine(await i.state.roster.get(), await i.state.pool.get())
  if (text === shownStatus) return
  shownStatus = text
  e.status(text)
}

// With the pane closed and nobody on the team there is nothing to read, so the tick skips the scan and the transcript reads.
// A tick that is still running makes the next one skip, so a slow scan cannot announce the same notice twice.
const flush = async (f: Fleet): Promise<void> => {
  const texts = outbox
  if (texts.length === 0 || submit === null) return
  outbox = []
  try {
    await submit(texts.join('\n\n'))
    unsent = false
  } catch {
    outbox = [...texts, ...outbox]
    if (!unsent) await f.note(false, 'could not tell the boss yet; trying again in a few seconds')
    unsent = true
  }
}

const tick = exclusive(async (f: Fleet, i: Io, e: Env): Promise<void> => {
  await e.own()
  if (paneOpen || Object.keys(await i.state.roster.get()).length > 0 || (await i.state.pool.get()).length > 0) await f.refresh()
  await flush(f)
  await showStatus(i, e)
})

// A handler that throws becomes a note in the pane instead of an unhandled rejection.
const guarded = (run: (f: Fleet) => Promise<unknown>): void => {
  const f = fleet
  if (f === null) return
  void run(f).catch(() => f.note(false, 'something went wrong; try again'))
}

const depsOf = ($: Parameters<Hook<'tool.call'>>[0], f: Fleet): ToolDeps => ({
  fleet: f,
  roster: () => read($, rosterAtom),
  pool: () => read($, poolAtom),
  now: () => $.clock.now(),
  selfId: () => $.session.id(),
  selfName: () => read($, bossAtom),
  employment: async id => parseEmployment(await $.store.get(hireKey(id))),
  store: storeOf($),
  send: sendOf($),
})

export const register: Register = (on, options) => {
  const config = readOptions(options)

  startConfig = config
  on('session.start', startHook)

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, clearedAtom, () => e.sessionId)
    else {
      stopPolling()
      outbox = []
      unsent = false
    }
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
    await owned($)
    const out = await runTool(spec.name as ToolName, e as unknown as Record<string, unknown>, depsOf($, f))
    return asToolResult(out)
  }).catch(($, e, next) => (next.called ? next(e) : asToolResult({ text: 'fleet-board could not run the tool.', isError: true })))

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (io === null || env === null || fleet === null) return { text: 'fleet-board has not started yet.' }
    const cmd = parseCommand(e.args ?? '')
    if (cmd.kind === 'bad') return { text: cmd.text }
    if (cmd.kind === 'init') {
      const text = await runBoss(
        depsOf($, fleet),
        (question, options) => $.ui.ask(question, options),
        async prompt => void outbox.push(prompt),
      )
      return { text }
    }
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
        pool: await read($, poolAtom),
        now,
        ...(row === undefined ? {} : { detail: { row, ...(hire === undefined ? {} : { hire }), now } }),
      },
      {
        onRefresh: () => guarded(f => f.refresh()),
        onClose: () => {
          paneOpen = false
          void $.ui.close({ id: PANE_ID })
        },
        onSelect: id => void update($, selectedAtom, () => id),
        onBack: () => void update($, selectedAtom, () => ''),
        onAction: key => guarded(f => paneAction(f, depsOf($, f), peers.find(p => p.id === selected), key)),
      },
    )
  })
}
