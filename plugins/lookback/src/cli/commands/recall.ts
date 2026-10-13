import { parseArgs } from 'node:util'

import { formatHits } from '../../core/search/format'
import { recallAsked } from '../../runtime/asked'
import type { Config } from '../../runtime/config'
import { recallPast } from '../../runtime/recall'
import { textOf } from '../args'
import { EXIT, UsageError } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForReading, refreshFor } from '../open'

// A prompt waits this long for the embedding server, then goes on without a recall.
const EMBED_TIMEOUT_MS = 1500
const OUTPUT_CHARS = 1500
// Two sessions of two turns each, whole.
const ASKED_OUTPUT_CHARS = 3000

const OPTIONS = {
  project: { type: 'string' },
  exclude: { type: 'string' },
  skip: { type: 'string' },
  asked: { type: 'boolean' },
  session: { type: 'string' },
} as const

export const recall = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const prompt = textOf(positionals, 'recall needs the prompt')
  const session = values.session ?? ''
  if (values.asked === true && session === '') throw new UsageError('recall --asked needs --session')

  // A refresh opens the index for writing, which would make one where there is none.
  if (values.asked === true) {
    const before = openForReading(config, io)
    if ('code' in before) return before.code
    before.store.close()
    await refreshFor(config, session)
  }

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const embedder = embedderFor(config, { timeoutMs: EMBED_TIMEOUT_MS })
    let found
    if (values.asked === true) {
      found = await recallAsked(store, embedder, prompt, { now: io.now(), session })
    } else {
      found = await recallPast(store, embedder, prompt, {
        now: io.now(),
        project: (values.project ?? '').replace(/\/+$/, ''),
        exclude: values.exclude ?? '',
        skip: new Set((values.skip ?? '').split(',').filter(id => id !== '')),
      })
    }
    if (found.hits.length > 0) io.stdout(`${formatHits(found.hits, found.terms, { maxChars: values.asked === true ? ASKED_OUTPUT_CHARS : OUTPUT_CHARS, offset: 0, more: 0 })}\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
