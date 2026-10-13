import { parseArgs } from 'node:util'

import { formatHits } from '../../core/search/format'
import type { Config } from '../../runtime/config'
import { searchPast } from '../../runtime/search'
import { integer, kindsOf, sinceOf, textOf } from '../args'
import { EXIT, UsageError } from '../io'
import type { ExitCode, Io } from '../io'
import { embedderFor, openForReading, refreshFor } from '../open'

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
  own: { type: 'string' },
  keyword: { type: 'boolean' },
  best: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

export const search = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const query = textOf(positionals, 'search needs a question')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 5)
  const offset = integer('offset', values.offset, 0, MAX_OFFSET, 0)
  const kinds = kindsOf(values.kind)
  const since = sinceOf(values.since, io.now())
  const own = values.own ?? ''
  if (own !== '' && values.exclude !== undefined) throw new UsageError('--own and --exclude cannot go together')

  // A refresh opens the index for writing, which would make one where there is none.
  if (own !== '') {
    const before = openForReading(config, io)
    if ('code' in before) return before.code
    before.store.close()
    await refreshFor(config, own)
  }

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const embedder = values.keyword === true ? null : embedderFor(config, { timeoutMs: QUERY_EMBED_TIMEOUT_MS })
    // The turn the search is asked in starts at the session's last prompt; the asker still sees it.
    const sessionBefore = own === '' ? undefined : { session: own, ts: store.lastSaid(own, 'user', io.now())?.ts ?? 0 }
    const found = await searchPast(store, embedder, query, {
      now: io.now(),
      limit,
      offset,
      project: values.project,
      kinds,
      since,
      excludeSession: values.exclude,
      sessionBefore,
      keywordOnly: values.keyword === true,
      order: values.best === true ? 'best' : 'newest',
    })
    const result = { ...found, hits: found.hits.map(hit => (hit.session === own ? { ...hit, own: true as const } : hit)) }
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
