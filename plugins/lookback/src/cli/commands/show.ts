import { parseArgs } from 'node:util'

import { formatSession } from '../../core/search/session'
import type { Config } from '../../runtime/config'
import { integer, kindsOf, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'
import { oneSession } from '../sessions'

const MAX_LIMIT = 500
const MAX_OFFSET = 1_000_000
const OUTPUT_CHARS = 8000
const ENTRY_CHARS = 400

const OPTIONS = {
  limit: { type: 'string' },
  offset: { type: 'string' },
  kind: { type: 'string', multiple: true },
  json: { type: 'boolean' },
} as const

export const show = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const prefix = textOf(positionals, 'show needs a session id, or the start of one')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 60)
  const offset = integer('offset', values.offset, 0, MAX_OFFSET, 0)
  const kinds = kindsOf(values.kind)

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const session = oneSession(store, prefix, io)
    if (session === null) return EXIT.failed
    const entries = store.sessionEntries(session.session, { limit, offset, kinds })
    const summary = kinds === undefined ? session : { ...session, entries: store.sessionCount(session.session, kinds) }
    io.stdout(
      values.json === true
        ? `${JSON.stringify({ session, offset, entries }, null, 2)}\n`
        : `${formatSession(summary, entries, { offset, maxChars: OUTPUT_CHARS, entryChars: ENTRY_CHARS })}\n`,
    )
    return EXIT.ok
  } finally {
    store.close()
  }
}
