import { parseArgs } from 'node:util'

import { formatFixes } from '../../core/search/fix'
import type { Config } from '../../runtime/config'
import { findFixes } from '../../runtime/fix'
import { integer, sinceOf, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const MAX_LIMIT = 20
const OUTPUT_CHARS = 6000

const OPTIONS = {
  limit: { type: 'string' },
  project: { type: 'string' },
  since: { type: 'string' },
  exclude: { type: 'string' },
  json: { type: 'boolean' },
} as const

export const fix = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const error = textOf(positionals, 'fix needs the text of an error')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 3)
  const since = sinceOf(values.since, io.now())

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  try {
    const result = findFixes(opened.store, error, { now: io.now(), limit, project: values.project, since, excludeSession: values.exclude })
    io.stdout(values.json === true ? `${JSON.stringify(result, null, 2)}\n` : `${formatFixes(result.fixes, result.terms, { maxChars: OUTPUT_CHARS })}\n`)
    return EXIT.ok
  } finally {
    opened.store.close()
  }
}
