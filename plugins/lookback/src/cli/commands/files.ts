import { parseArgs } from 'node:util'

import { formatFiles } from '../../core/search/blame'
import { formatSessionList } from '../../core/search/session'
import type { Config } from '../../runtime/config'
import { integer, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'
import { oneSession } from '../sessions'

const MAX_LIMIT = 1000

const OPTIONS = {
  limit: { type: 'string' },
  json: { type: 'boolean' },
} as const

export const files = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const prefix = textOf(positionals, 'files needs a session id, or the start of one')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 100)

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const session = oneSession(store, prefix, io)
    if (session === null) return EXIT.failed
    const uses = store.sessionFiles(session.session, limit)
    io.stdout(values.json === true ? `${JSON.stringify({ session, files: uses }, null, 2)}\n` : `${formatFiles(formatSessionList([session]), uses)}\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
