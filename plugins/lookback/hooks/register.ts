import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import { NO_COMMAND, NO_FIX, TOOL_NAME, TOOL_SPEC, WHEN_TO_SEARCH, argvOf, askedArgv, captionNotice, cliEnv, commandArgv, commandText, fileContext, fileNoteArgv, fixContext, recallArgv, recallContext, recentSection, requestOf, shownIds } from '../src/core/call'
import { readOptions } from '../src/core/options'
import type { Options } from '../src/core/options'
import { errorGist } from '../src/core/search/fix'
import { cutSent } from '../src/core/seen'
import { worthAsking } from '../src/core/search/gate'
import { asksAboutPast } from '../src/core/search/intent'
import { fileCallOf, fileToolsOf } from '../src/core/transcript/touches'

type Engine = Parameters<Hook<'session.start'>>[0]

const TOOL = TOOL_NAME
const INDEX_MS = 600_000
const SEARCH_MS = 20_000
const INSTALL_MS = 180_000
// A failed command waits at most this long for what past sessions did about its error.
const FIX_MS = 5000
const FIX_LIMIT = 2
// A shorter error text names nothing a past session could be found by.
const MIN_GIST_CHARS = 12
// A prompt that asks about the past waits at most this long: its session's new turns are read, then searched.
const ASKED_MS = 8000
// A prompt waits at most this long for the recall that matches it on meaning; the embedding server gets 1.5 s of it.
const GATE_MS = 4000
// The system prompt waits at most this long for the list of recent sessions.
const DIGEST_MS = 3000
const DIGEST_LIMIT = 5
// A file's note waits at most this long, and one call names at most this many files.
const NOTE_MS = 3000
const NOTE_FILES = 2
const TRANSCRIPT_MS = 800
const NO_BUN = 'lookback could not run. Is bun installed?'

// What this session was already shown, kept across reloads of the plugin and dropped on /clear.
const notedAtom = atom({ plugin: 'lookback', key: 'noted' } as const, [])
const lookedUpAtom = atom({ plugin: 'lookback', key: 'lookedUp' } as const, [])
const shownAtom = atom({ plugin: 'lookback', key: 'shown' } as const, [])
const sentAtom = atom({ plugin: 'lookback', key: 'sent' } as const, {})

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

type Run = { code: number; out: string; err: string }

const asToolResult = (text: string, isError = false) => (isError ? { result: text, isError: true as const } : { result: text })

// Runs `lookback <args>` and reports how it ended. A command that cannot start rejects.
const lookback = async ($: Engine, options: Options, args: readonly string[], timeoutMs: number): Promise<Run> => {
  const out = await $.process.run(['bun', `${$.plugin.root}/bin/lookback.ts`, ...args], {
    cwd: $.plugin.root,
    env: cliEnv(options),
    timeoutMs,
  })
  return { code: out.exitCode, out: out.stdout.trim(), err: out.stderr.trim() }
}

const ensurePackages = async ($: Engine): Promise<void> => {
  if (await $.fs.exists(`${$.plugin.root}/node_modules`)) return
  await $.process.run(['bun', 'install', '--frozen-lockfile'], { cwd: $.plugin.root, timeoutMs: INSTALL_MS })
}

// Brings the index up to date. It never throws: a failure becomes one toast.
const refreshIndex = async ($: Engine, options: Options, wait = false): Promise<void> => {
  try {
    await ensurePackages($)
    const run = await lookback($, options, wait ? ['index', '--quiet', '--wait'] : ['index', '--quiet'], INDEX_MS)
    if (run.code !== 0) {
      await $.ui.toast(`lookback: indexing failed: ${run.err || `exit ${run.code}`}`)
      return
    }
    const captions = captionNotice(run.err)
    if (captions !== null) await $.ui.toast(captions)
  } catch {
    await $.ui.toast('lookback: could not run bun, so past sessions are not indexed. Install bun from bun.sh.')
  }
}

type Captioning = { running: boolean; again: boolean }

const captionImages = async ($: Engine, options: Options, state: Captioning): Promise<void> => {
  if (state.running) {
    state.again = true
    return
  }
  state.running = true
  try {
    do {
      state.again = false
      await refreshIndex($, options, true)
    } while (state.again)
  } finally {
    state.running = false
  }
}

// What past sessions ran after the error a failed command ended with, as a block for the model, or null.
const pastFix = async ($: Engine, options: Options, gist: string): Promise<string | null> => {
  try {
    const argv = argvOf({ query: gist, mode: 'fix', limit: FIX_LIMIT }, { limit: FIX_LIMIT, exclude: await $.session.id(), brief: true })
    const run = await lookback($, options, argv, FIX_MS)
    return run.code !== 0 || run.out === '' || run.out === NO_FIX ? null : fixContext(run.out)
  } catch {
    return null
  }
}

// The latest sessions run in a folder, one line each, or '' when there are none or the index cannot answer.
const recentSessions = async ($: Engine, options: Options, cwd: string): Promise<string> => {
  try {
    const run = await lookback($, options, ['recent', '--titled', '--exact', '--project', cwd, '--exclude', await $.session.id(), '--limit', String(DIGEST_LIMIT)], DIGEST_MS)
    return run.code === 0 ? run.out : ''
  } catch {
    return ''
  }
}

// What earlier sessions did to a file, as a block for the model, or null when it has no history or the index cannot answer.
const pastOfFile = async ($: Engine, options: Options, path: string, folder: string): Promise<string | null> => {
  try {
    const run = await lookback($, options, fileNoteArgv(path, await $.session.id(), folder), NOTE_MS)
    return run.code !== 0 || run.out === '' ? null : fileContext(path, run.out)
  } catch {
    return null
  }
}

export const register: Register = (on, raw) => {
  const options = readOptions(raw)
  const isFileTool = fileToolsOf(options.fileTools)
  let digest: Promise<string> = Promise.resolve('')
  let folder = ''
  const captionsOn = options.autoIndex && (options.captionServer !== '' || options.captionModel !== '')
  let imagesWaiting = false
  let imagesRecheck = false
  const captioning = { running: false, again: false }

  on('session.start', async ($, e, next) => {
    folder = e.cwd
    await $.tool.register(TOOL_SPEC)
    await $.command.register({ name: 'lookback', description: 'Search your past Claude Code sessions', argumentHint: '<question> | show <id> | fix <error> | how <words> | blame <file> | files <id> | forget <id> | recent | stats | doctor | index' })
    // The system prompt waits for the list; the start of the session does not.
    if (options.sessionDigest && e.isInteractive) digest = recentSessions($, options, e.cwd)
    if (options.autoIndex) void refreshIndex($, options)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async (_$, e, next) => {
    const composed = await next(e)
    const recent = await digest
    return {
      sections: [
        ...composed.sections,
        { id: 'lookback:when', text: WHEN_TO_SEARCH, scope: 'session' as const },
        ...(recent === '' ? [] : [{ id: 'lookback:recent', text: recentSection(recent), scope: 'session' as const }]),
      ],
    }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Bash' && options.errorHints) {
      const out = await next(e)
      if (out.isError !== true) return out
      const gist = errorGist(out.text ?? '')
      if (gist.length < MIN_GIST_CHARS) return out
      let fresh = false
      await update($, lookedUpAtom, seen => {
        fresh = !seen.includes(gist)
        return fresh ? [...seen, gist] : seen
      })
      if (!fresh) return out
      const found = await pastFix($, options, gist)
      return found === null ? out : { ...out, context: [...(out.context ?? []), found] }
    }
    const touched = options.fileNotes ? fileCallOf(e.tool, e, isFileTool) : null
    if (touched !== null) {
      let fresh: string[] = []
      await update($, notedAtom, noted => {
        fresh = touched.paths.filter(p => !noted.includes(p)).slice(0, NOTE_FILES)
        return fresh.length === 0 ? noted : [...noted, ...fresh]
      })
      // The lookups run beside the call; they never reject.
      const looked = Promise.all(fresh.map(path => pastOfFile($, options, path, folder)))
      const out = await next(e)
      if (out.deny !== undefined) {
        await update($, notedAtom, noted => noted.filter(p => !fresh.includes(p)))
        return out
      }
      const notes = (await looked).filter((n): n is string => n !== null)
      return notes.length === 0 ? out : { ...out, context: [...(out.context ?? []), ...notes] }
    }
    if (e.tool !== TOOL) return next(e)
    const request = requestOf(e)
    if ('error' in request) return asToolResult(`lookback: ${request.error}`, true)
    try {
      const argv = argvOf(request, { limit: options.limit, exclude: await $.session.id(), ownTurns: true })
      const run = await lookback($, options, argv, SEARCH_MS)
      if (run.code !== 0) return asToolResult(run.err || `lookback exited with ${run.code}`, true)
      const loop = e.agentId ?? ''
      const isRead = request.session !== undefined
      let text = run.out
      await update($, sentAtom, all => {
        const seen = new Set(all[loop] ?? [])
        const cut = cutSent(run.out, isRead ? new Set() : seen)
        if (!isRead) text = cut.text
        const fresh = cut.sent.filter(line => !seen.has(line))
        return fresh.length === 0 ? all : { ...all, [loop]: [...(all[loop] ?? []), ...fresh] }
      })
      return asToolResult(text)
    } catch {
      return asToolResult(NO_BUN, true)
    }
  }).catch(($, e, next) => (e.tool === TOOL ? asToolResult('lookback could not answer the search.', true) : next(e)))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, notedAtom, () => [])
      await update($, lookedUpAtom, () => [])
      await update($, shownAtom, () => [])
      await update($, sentAtom, () => ({}))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    if (e.trigger === 'precompute' || out.skip !== undefined) return out
    const loop = e.agentId ?? ''
    await update($, sentAtom, all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== loop)))
    return out
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'lookback' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const me = await $.session.id()
      const argv = commandArgv(args, options.limit, me)
      let run = await lookback($, options, argv, argv[0] === 'index' ? INDEX_MS : SEARCH_MS)
      // "how did we fix the build" is a question, not words of a command: with nothing found, search for it.
      if (run.code === 0 && (run.out === NO_FIX || run.out === NO_COMMAND)) run = await lookback($, options, argvOf({ query: args }, { limit: options.limit, exclude: me }), SEARCH_MS)
      return { text: commandText(run) }
    } catch {
      return { text: NO_BUN }
    }
  }).catch(() => ({ text: 'lookback could not answer the command.' }))

  on('turn.start', async ($, e, next) => {
    if (imagesWaiting) {
      imagesWaiting = false
      imagesRecheck = true
      void wait(TRANSCRIPT_MS)
        .then(() => captionImages($, options, captioning))
        .catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (imagesRecheck) {
      imagesRecheck = false
      void captionImages($, options, captioning).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (captionsOn && e.attachments?.some(a => a.type === 'image') === true) imagesWaiting = true
    if (!options.autoRecall || e.origin.kind !== 'composer') return next(e)
    try {
      const me = await $.session.id()
      let found = ''
      if (asksAboutPast(e.text)) {
        const run = await lookback($, options, askedArgv(e.text, me), ASKED_MS)
        if (run.code === 0) found = run.out
      } else if (worthAsking(e.text)) {
        const run = await lookback($, options, recallArgv(e.text, folder, me, new Set(await read($, shownAtom))), GATE_MS)
        if (run.code === 0) found = run.out
      }
      if (found === '') return next(e)
      const ids = shownIds(found)
      await update($, shownAtom, shown => [...shown, ...ids.filter(id => !shown.includes(id))])
      return next({ ...e, context: [...(e.context ?? []), recallContext(found)] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}
