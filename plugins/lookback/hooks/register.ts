import type { Hook, Register } from 'claude-code'

import { TOOL_SPEC, cliEnv, recallContext, searchArgv, searchRequestOf } from '../src/core/call'
import { readOptions } from '../src/core/options'
import type { Options } from '../src/core/options'
import { asksAboutPast } from '../src/core/search/intent'

type Engine = Parameters<Hook<'session.start'>>[0]

const TOOL = `mcp__lookback__${TOOL_SPEC.name}`
const INDEX_MS = 600_000
const SEARCH_MS = 20_000
const INSTALL_MS = 180_000
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

const commandArgv = (args: string, limit: number, exclude: string): string[] => {
  if (args === '') return ['stats']
  if (args === 'stats' || args === 'doctor' || args === 'index') return [args]
  return searchArgv({ query: args }, { limit, exclude })
}

export const register: Register = (on, raw) => {
  const options = readOptions(raw)

  on('session.start', async ($, e, next) => {
    await $.tool.register(TOOL_SPEC)
    await $.command.register({ name: 'lookback', description: 'Search your past Claude Code sessions', argumentHint: '<question> | stats | doctor | index' })
    if (options.autoIndex) void refreshIndex($, options)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.tool !== TOOL) return next(e)
    const request = searchRequestOf(e)
    if ('error' in request) return asToolResult(`lookback: ${request.error}`, true)
    try {
      const argv = searchArgv(request, { limit: options.limit, exclude: await $.session.id() })
      const run = await lookback($, options, argv, SEARCH_MS)
      return run.code === 0 ? asToolResult(run.out) : asToolResult(run.err || `lookback exited with ${run.code}`, true)
    } catch {
      return asToolResult(NO_BUN, true)
    }
  }).catch(($, e, next) => (e.tool === TOOL ? asToolResult('lookback could not answer the search.', true) : next(e)))

  on('command.run', { command: 'lookback' }, async ($, e) => {
    try {
      const argv = commandArgv(e.args.trim(), options.limit, await $.session.id())
      const run = await lookback($, options, argv, argv[0] === 'index' ? INDEX_MS : SEARCH_MS)
      return { text: run.code === 0 ? run.out : run.err || `lookback exited with ${run.code}` }
    } catch {
      return { text: NO_BUN }
    }
  }).catch(() => ({ text: 'lookback could not answer the command.' }))

  on('prompt.submit', async ($, e, next) => {
    if (!options.autoRecall || e.origin.kind !== 'composer' || !asksAboutPast(e.text)) return next(e)
    try {
      const argv = searchArgv({ query: e.text }, { limit: RECALL_LIMIT, exclude: await $.session.id() })
      const run = await lookback($, options, argv, SEARCH_MS)
      if (run.code !== 0 || run.out === '' || run.out === NONE) return next(e)
      return next({ ...e, context: [...(e.context ?? []), recallContext(run.out)] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}
