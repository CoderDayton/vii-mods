import type { Hook, Register } from 'claude-code'

import { NO_COMMAND, NO_FIX, TOOL_SPEC, argvOf, cliEnv, commandArgv, fixContext, recallContext, requestOf } from '../src/core/call'
import { readOptions } from '../src/core/options'
import type { Options } from '../src/core/options'
import { errorGist } from '../src/core/search/fix'
import { asksAboutPast } from '../src/core/search/intent'

type Engine = Parameters<Hook<'session.start'>>[0]

const TOOL = `mcp__lookback__${TOOL_SPEC.name}`
const INDEX_MS = 600_000
const SEARCH_MS = 20_000
const INSTALL_MS = 180_000
// A failed command waits at most this long for what past sessions did about its error.
const FIX_MS = 5000
const FIX_LIMIT = 2
// A shorter error text names nothing a past session could be found by.
const MIN_GIST_CHARS = 12
// A recall that rides along with a prompt shows fewer sessions than a search the model asks for.
const RECALL_LIMIT = 3
const NONE = 'No past session matches.'
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

export const register: Register = (on, raw) => {
  const options = readOptions(raw)
  // The errors already looked up in this session: a command retried in a loop asks once.
  const lookedUp = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.tool.register(TOOL_SPEC)
    await $.command.register({ name: 'lookback', description: 'Search your past Claude Code sessions', argumentHint: '<question> | show <id> | fix <error> | how <words> | blame <file> | files <id> | forget <id> | stats | doctor | index' })
    if (options.autoIndex) void refreshIndex($, options)
    return next(e)
  }).catch(($, e, next) => next(e))

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
    if (e.tool !== TOOL) return next(e)
    const request = requestOf(e)
    if ('error' in request) return asToolResult(`lookback: ${request.error}`, true)
    try {
      const argv = argvOf(request, { limit: options.limit, exclude: await $.session.id() })
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
    if (!options.autoRecall || e.origin.kind !== 'composer' || !asksAboutPast(e.text)) return next(e)
    try {
      const argv = argvOf({ query: e.text }, { limit: RECALL_LIMIT, exclude: await $.session.id() })
      const run = await lookback($, options, argv, SEARCH_MS)
      if (run.code !== 0 || run.out === '' || run.out === NONE) return next(e)
      return next({ ...e, context: [...(e.context ?? []), recallContext(run.out)] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}
