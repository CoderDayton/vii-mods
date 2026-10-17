import { existsSync } from 'node:fs'

import { commandWords } from '../../core/text/command'
import type { Config } from '../../runtime/config'
import { runtimeInfo, runtimeProblem } from '../../runtime/runtime'
import { StoreMissingError } from '../../runtime/store/errors'
import { Store } from '../../runtime/store/store'
import { listTranscripts } from '../../runtime/transcript/scan'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor } from '../open'

type Check = { level: 'ok' | 'warn'; name: string; detail: string }

const PROBE_TIMEOUT_MS = 4000

const transcripts = async (config: Config): Promise<Check> => {
  const files = await listTranscripts(config.projectsRoot)
  return files.length === 0
    ? { level: 'warn', name: 'transcripts', detail: `none under ${config.projectsRoot}` }
    : { level: 'ok', name: 'transcripts', detail: `${files.length} under ${config.projectsRoot}` }
}

const runtime = (): Check => {
  const info = runtimeInfo()
  const problem = runtimeProblem(info.bun)
  const detail = `bun ${info.bun}, sqlite ${info.sqlite}, sqlite-vector ${info.vector}`
  return problem === null ? { level: 'ok', name: 'runtime', detail } : { level: 'warn', name: 'runtime', detail: `${detail}; ${problem}` }
}

type IndexCheck = { check: Check; model: string | null }

const describeIndex = (store: Store, path: string): IndexCheck => {
  const s = store.stats()
  return { check: { level: 'ok', name: 'index', detail: `${s.entries} entries, ${s.sessions} sessions, ${s.chunks} vectors at ${path}` }, model: s.model }
}

// The index check, and the model the index holds vectors for (null when none).
const index = (config: Config): IndexCheck => {
  let store: Store
  try {
    store = Store.open(config.databasePath, { readOnly: true })
  } catch (error) {
    if (error instanceof StoreMissingError) return { check: { level: 'warn', name: 'index', detail: 'not built yet; run "lookback index"' }, model: null }
    throw error
  }
  try {
    return describeIndex(store, config.databasePath)
  } finally {
    store.close()
  }
}

const server = async (config: Config, indexed: string | null): Promise<Check> => {
  const { baseURL, model } = config.embedding
  try {
    const dimension = await embedderFor(config, { timeoutMs: PROBE_TIMEOUT_MS }).dimension()
    const mismatch = indexed !== null && indexed !== model ? `; the index holds vectors of ${indexed}, so the next "lookback index" rebuilds them` : ''
    return { level: mismatch === '' ? 'ok' : 'warn', name: 'embedding server', detail: `${baseURL} answers with ${model}, ${dimension} values each${mismatch}` }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { level: 'warn', name: 'embedding server', detail: `${baseURL} did not answer (${reason}); searches use words only` }
  }
}

// llama-server's flags that name a file the server needs.
const MODEL_FLAGS = new Set(['-m', '--model', '-mm', '--mmproj'])

const modelFiles = (words: readonly string[]): string[] =>
  words.flatMap((w, i) => {
    if (MODEL_FLAGS.has(words[i - 1] ?? '')) return [w]
    const eq = w.indexOf('=')
    return eq > 0 && MODEL_FLAGS.has(w.slice(0, eq)) ? [w.slice(eq + 1)] : []
  })

// Whether the caption server can start, or the caption endpoint serves the model. Loads no model.
const captions = async (config: Config): Promise<Check> => {
  const { server: command, model, baseURL, apiKey } = config.caption
  const name = 'image captions'
  if (command !== '') {
    const words = commandWords(command)
    const program = words[0] ?? ''
    const missing = [
      ...((program.includes('/') ? existsSync(program) : Bun.which(program) !== null) ? [] : [program]),
      ...modelFiles(words).filter(f => !existsSync(f)),
    ]
    return missing.length === 0
      ? { level: 'ok', name, detail: `${program} is started for each run with images to caption` }
      : { level: 'warn', name, detail: `${missing.join(', ')} not found, so pasted images wait uncaptioned` }
  }
  if (model === '') return { level: 'ok', name, detail: 'off; set captionServer or captionModel to caption pasted images' }
  try {
    const { default: OpenAI } = await import('openai')
    const models = await new OpenAI({ baseURL, apiKey, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 }).models.list()
    const served = models.data.some(m => m.id === model || m.id === `${model}:latest`)
    return served ? { level: 'ok', name, detail: `${baseURL} serves ${model}` } : { level: 'warn', name, detail: `${baseURL} does not list ${model}` }
  } catch (error) {
    return { level: 'warn', name, detail: `${baseURL} did not answer (${error instanceof Error ? error.message : String(error)})` }
  }
}

export const doctor = async (_argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const found = index(config)
  const checks = [runtime(), await transcripts(config), found.check, await server(config, found.model), await captions(config)]
  io.stdout(`${checks.map(c => `${c.level.padEnd(5)} ${c.name.padEnd(17)} ${c.detail}`).join('\n')}\n`)
  return EXIT.ok
}
