import { parseArgs } from 'node:util'

import { formatHits } from '../../core/search/format'
import { durationMs } from '../../core/text/duration'
import type { EntryKind } from '../../core/types'
import type { Config } from '../../runtime/config'
import { searchPast } from '../../runtime/search'
import { EXIT, UsageError } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForReading } from '../open'

const KINDS: readonly EntryKind[] = ['user', 'assistant', 'error', 'cmd']
const MAX_LIMIT = 50
// A search waits this long for the embedding server, then falls back to words.
const QUERY_EMBED_TIMEOUT_MS = 4000
const OUTPUT_CHARS = 6000

const OPTIONS = {
  limit: { type: 'string' },
  project: { type: 'string' },
  kind: { type: 'string', multiple: true },
  since: { type: 'string' },
  exclude: { type: 'string' },
  keyword: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

const integer = (name: string, text: string | undefined, min: number, max: number, fallback: number): number => {
  if (text === undefined) return fallback
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`)
  return value
}

const kindsOf = (names: readonly string[] | undefined): EntryKind[] | undefined => {
  if (names === undefined) return undefined
  const bad = names.find(n => !KINDS.includes(n as EntryKind))
  if (bad !== undefined) throw new UsageError(`--kind must be one of ${KINDS.join(', ')}, not "${bad}"`)
  return names as EntryKind[]
}

export const search = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const query = positionals.join(' ').trim()
  if (query === '') throw new UsageError('search needs a question')

  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 5)
  const kinds = kindsOf(values.kind)
  let since: number | undefined
  if (values.since !== undefined) {
    const span = durationMs(values.since)
    if (span === null) throw new UsageError(`--since must look like 12h, 30d or 2w, not "${values.since}"`)
    since = io.now() - span
  }

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const embedder = values.keyword === true ? null : embedderFor(config, { timeoutMs: QUERY_EMBED_TIMEOUT_MS })
    const result = await searchPast(store, embedder, query, {
      now: io.now(),
      limit,
      project: values.project,
      kinds,
      since,
      excludeSession: values.exclude,
      keywordOnly: values.keyword === true,
    })
    if (result.semantic === 'unavailable') io.stderr('lookback: the embedding server did not answer; matched on words only\n')
    io.stdout(
      values.json === true
        ? `${JSON.stringify({ query, terms: result.terms, semantic: result.semantic, hits: result.hits }, null, 2)}\n`
        : `${formatHits(result.hits, result.terms, { maxChars: OUTPUT_CHARS })}\n`,
    )
    return EXIT.ok
  } finally {
    store.close()
  }
}
