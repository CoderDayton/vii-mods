import { parseArgs } from 'node:util'

import type { Config } from '../../runtime/config'
import { indexAll } from '../../runtime/indexer'
import type { Progress } from '../../runtime/indexer'
import { StoreBusyError } from '../../runtime/store/errors'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForWriting } from '../open'

const OPTIONS = {
  'no-embed': { type: 'boolean' },
  quiet: { type: 'boolean' },
} as const

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

export const index = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
  let store
  try {
    store = await openForWriting(config)
  } catch (error) {
    if (!(error instanceof StoreBusyError)) throw error
    io.stderr('lookback: an index run is already running\n')
    return EXIT.ok
  }
  try {
    const report = await indexAll(store, {
      projectsRoot: config.projectsRoot,
      fileTools: config.fileTools,
      embedder: values['no-embed'] === true ? null : embedderFor(config),
      onProgress: values.quiet === true ? undefined : progressPrinter(io),
    })
    io.stdout(`Indexed ${report.files} files: ${report.entries} entries, ${report.chunks} vectors.\n`)
    if (report.embeddingError !== null) io.stderr(`lookback: embedding stopped (${report.embeddingError}); keyword search still works\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
