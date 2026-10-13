import type { Hook, Register } from 'claude-code'

import { NO_COMMAND, NO_FIX, TOOL_NAME, TOOL_SPEC, WHEN_TO_SEARCH, argvOf, askedArgv, cliEnv, commandArgv, fileContext, fileNoteArgv, fixContext, recallArgv, recallContext, recentSection, requestOf, shownIds } from '../src/core/call'
import { readOptions } from '../src/core/options'
import type { Options } from '../src/core/options'
import { errorGist } from '../src/core/search/fix'
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
const NO_BUN = 'lookback could not run. Is bun installed?'

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
const refreshIndex = async ($: Engine, options: Options): Promise<void> => {
  try {
    await ensurePackages($)
    const run = await lookback($, options, ['index', '--quiet'], INDEX_MS)
    if (run.code !== 0) await $.ui.toast(`lookback: indexing failed: ${run.err || `exit ${run.code}`}`)
  } catch {
    await $.ui.toast('lookback: could not run bun, so past sessions are not indexed. Install bun from bun.sh.')
  }
}

// What past sessions ran after the error a failed command ended with, as a block for the model, or null.
const pastFix = async ($: Engine, options: Options, gist: string): Promise<string | null> => {
  try {
    const argv = argvOf({ query: gist, mode: 'fix', limit: FIX_LIMIT }, { limit: FIX_LIMIT, exclude: await $.session.id() })
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
  // The sessions this one was already shown, by the start of their ids.
  const shown = new Set<string>()
  // The errors already looked up in this session: a command retried in a loop asks once.
  const lookedUp = new Set<string>()
  // The files already noted in this session: a file is noted on its first touch only.
  const noted = new Set<string>()

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
      if (gist.length < MIN_GIST_CHARS || lookedUp.has(gist)) return out
      lookedUp.add(gist)
      const found = await pastFix($, options, gist)
      return found === null ? out : { ...out, context: [...(out.context ?? []), found] }
    }
    const touched = options.fileNotes ? fileCallOf(e.tool, e, isFileTool) : null
    if (touched !== null) {
      const fresh = touched.paths.filter(p => !noted.has(p)).slice(0, NOTE_FILES)
      for (const path of fresh) noted.add(path)
      // The lookups run beside the call; they never reject.
      const looked = Promise.all(fresh.map(path => pastOfFile($, options, path, folder)))
      const out = await next(e)
      if (out.deny !== undefined) {
        for (const path of fresh) noted.delete(path)
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
      return run.code === 0 ? asToolResult(run.out) : asToolResult(run.err || `lookback exited with ${run.code}`, true)
    } catch {
      return asToolResult(NO_BUN, true)
    }
  }).catch(($, e, next) => (e.tool === TOOL ? asToolResult('lookback could not answer the search.', true) : next(e)))

  on('command.run', { command: 'lookback' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const me = await $.session.id()
      const argv = commandArgv(args, options.limit, me)
      let run = await lookback($, options, argv, argv[0] === 'index' ? INDEX_MS : SEARCH_MS)
      // "how did we fix the build" is a question, not words of a command: with nothing found, search for it.
      if (run.code === 0 && (run.out === NO_FIX || run.out === NO_COMMAND)) run = await lookback($, options, argvOf({ query: args }, { limit: options.limit, exclude: me }), SEARCH_MS)
      return { text: run.code === 0 ? run.out : run.err || `lookback exited with ${run.code}` }
    } catch {
      return { text: NO_BUN }
    }
  }).catch(() => ({ text: 'lookback could not answer the command.' }))

  on('prompt.submit', async ($, e, next) => {
    if (!options.autoRecall || e.origin.kind !== 'composer') return next(e)
    try {
      const me = await $.session.id()
      let found = ''
      if (asksAboutPast(e.text)) {
        const run = await lookback($, options, askedArgv(e.text, me), ASKED_MS)
        if (run.code === 0) found = run.out
      } else if (worthAsking(e.text)) {
        const run = await lookback($, options, recallArgv(e.text, folder, me, shown), GATE_MS)
        if (run.code === 0) found = run.out
      }
      if (found === '') return next(e)
      for (const id of shownIds(found)) shown.add(id)
      return next({ ...e, context: [...(e.context ?? []), recallContext(found)] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}
