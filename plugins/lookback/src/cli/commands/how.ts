import { parseArgs } from 'node:util'

import { formatCommands } from '../../core/search/how'
import { termsOf } from '../../core/text/terms'
import type { Config } from '../../runtime/config'
import { integer, sinceOf, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const MAX_LIMIT = 50

const OPTIONS = {
  limit: { type: 'string' },
  project: { type: 'string' },
  since: { type: 'string' },
  exclude: { type: 'string' },
  json: { type: 'boolean' },
} as const

export const how = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const words = textOf(positionals, 'how needs words of the command to look for')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 8)
  const since = sinceOf(values.since, io.now())

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  try {
    const commands = opened.store.commands(termsOf(words), limit, { project: values.project, since, excludeSession: values.exclude })
    io.stdout(values.json === true ? `${JSON.stringify({ commands }, null, 2)}\n` : `${formatCommands(commands)}\n`)
    return EXIT.ok
  } finally {
    opened.store.close()
  }
}
