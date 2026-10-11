import { parseArgs } from 'node:util'

import { formatHits } from '../../core/search/format'
import type { Config } from '../../runtime/config'
import { searchPast } from '../../runtime/search'
import { integer, kindsOf, sinceOf, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForReading } from '../open'

const MAX_LIMIT = 50
const MAX_OFFSET = 500
// A search waits this long for the embedding server, then falls back to words.
const QUERY_EMBED_TIMEOUT_MS = 4000
const OUTPUT_CHARS = 6000

const OPTIONS = {
  limit: { type: 'string' },
  offset: { type: 'string' },
  project: { type: 'string' },
  kind: { type: 'string', multiple: true },
  since: { type: 'string' },
  exclude: { type: 'string' },
  keyword: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

export const search = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const query = textOf(positionals, 'search needs a question')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 5)
  const offset = integer('offset', values.offset, 0, MAX_OFFSET, 0)
  const kinds = kindsOf(values.kind)
  const since = sinceOf(values.since, io.now())

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const embedder = values.keyword === true ? null : embedderFor(config, { timeoutMs: QUERY_EMBED_TIMEOUT_MS })
    const result = await searchPast(store, embedder, query, {
      now: io.now(),
      limit,
      offset,
      project: values.project,
      kinds,
      since,
      excludeSession: values.exclude,
      keywordOnly: values.keyword === true,
    })
    if (result.semantic === 'unavailable') io.stderr('lookback: the embedding server did not answer; matched on words only\n')
    io.stdout(
      values.json === true
        ? `${JSON.stringify({ query, terms: result.terms, semantic: result.semantic, offset, more: result.more, hits: result.hits }, null, 2)}\n`
        : `${formatHits(result.hits, result.terms, { maxChars: OUTPUT_CHARS, offset, more: result.more })}\n`,
    )
    return EXIT.ok
  } finally {
    store.close()
  }
}
