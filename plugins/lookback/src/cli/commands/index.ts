import { parseArgs } from 'node:util'

import { captionSourceFor } from '../../runtime/captions/captioner'
import type { Config } from '../../runtime/config'
import { indexAll } from '../../runtime/indexer'
import type { IndexReport, Progress } from '../../runtime/indexer'
import { StoreBusyError } from '../../runtime/store/errors'
import type { Store } from '../../runtime/store/store'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForWriting } from '../open'

const OPTIONS = {
  'no-embed': { type: 'boolean' },
  quiet: { type: 'boolean' },
  wait: { type: 'boolean' },
} as const

const WAIT_POLL_MS = 250
const WAIT_MS = 60_000

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const took = (ms: number): string => {
  if (ms < 1000) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? ` in ${s}s` : ` in ${Math.floor(s / 60)}m ${s % 60}s`
}

const summary = (report: IndexReport, ms: number): string => {
  if (report.files === 0 && report.entries === 0 && report.images === 0 && report.chunks === 0) return 'Nothing new: the index is up to date.'
  const parts = [
    plural(report.entries, 'new entry', 'new entries'),
    ...(report.images === 0 ? [] : [plural(report.images, 'image caption')]),
    plural(report.chunks, 'vector'),
  ]
  return `Read ${plural(report.files, 'transcript')}${took(ms)}: ${parts.join(', ')}.`
}

const openWhenFree = async (config: Config, waitMs: number): Promise<{ store: Store; waited: boolean } | null> => {
  const deadline = Date.now() + waitMs
  for (let waited = false; ; waited = true) {
    try {
      return { store: await openForWriting(config), waited }
    } catch (error) {
      if (!(error instanceof StoreBusyError)) throw error
      if (Date.now() >= deadline) return null
      await Bun.sleep(WAIT_POLL_MS)
    }
  }
}

// Prints a line each time a tenth of a phase is done.
const progressPrinter = (io: Io) => {
  const shown = new Map<Progress['phase'], number>()
  return (p: Progress): void => {
    const tenth = p.total === 0 ? 10 : Math.floor((p.done / p.total) * 10)
    if (tenth === shown.get(p.phase)) return
    shown.set(p.phase, tenth)
    const unit = p.phase === 'transcripts' ? 'MiB' : 'entries'
    const scale = p.phase === 'transcripts' ? 1024 * 1024 : 1
    io.stderr(`lookback: ${p.phase} ${Math.round(p.done / scale)} of ${Math.round(p.total / scale)} ${unit}\n`)
  }
}

export const index = async (argv: string[], io: Io, config: Config, waitMs = WAIT_MS): Promise<ExitCode> => {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
  const wait = values.wait === true
  const opened = await openWhenFree(config, wait ? waitMs : 0)
  if (opened === null) {
    io.stderr(wait ? `lookback: the index run already going is still running after ${Math.round(waitMs / 1000)}s; it finishes on its own\n` : 'lookback: an index run is already running\n')
    return EXIT.ok
  }
  const { store, waited } = opened
  if (waited) io.stdout('Waited for the index run already going.\n')
  const started = performance.now()
  try {
    const report = await indexAll(store, {
      projectsRoot: config.projectsRoot,
      fileTools: config.fileTools,
      embedder: values['no-embed'] === true ? null : embedderFor(config),
      captions: config.caption.named ? captionSourceFor(config) : undefined,
      onProgress: values.quiet === true ? undefined : progressPrinter(io),
    })
    io.stdout(`${summary(report, performance.now() - started)}\n`)
    if (report.embeddingError !== null) io.stderr(`lookback: embedding stopped (${report.embeddingError}); keyword search still works\n`)
    if (report.captionError !== null) io.stderr(`lookback: image captions stopped (${report.captionError}); the images wait for the next run\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
