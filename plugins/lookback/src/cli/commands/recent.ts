import { parseArgs } from 'node:util'

import { formatRecent } from '../../core/search/session'
import type { Config } from '../../runtime/config'
import { integer } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const MAX_LIMIT = 100

const OPTIONS = {
  project: { type: 'string' },
  exclude: { type: 'string' },
  limit: { type: 'string' },
  titled: { type: 'boolean' },
  exact: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

export const recent = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 5)

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  try {
    const sessions = opened.store.recent((values.project ?? '').replace(/\/+$/, ''), limit, values.exclude, values.titled === true, values.exact === true)
    if (values.json === true) io.stdout(`${JSON.stringify(sessions, null, 2)}\n`)
    else if (sessions.length > 0) io.stdout(`${formatRecent(sessions)}\n`)
    return EXIT.ok
  } finally {
    opened.store.close()
  }
}
