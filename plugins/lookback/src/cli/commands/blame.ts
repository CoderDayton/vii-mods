import { parseArgs } from 'node:util'

import { formatBlame } from '../../core/search/blame'
import type { Blame } from '../../core/search/blame'
import type { Config } from '../../runtime/config'
import { integer, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const MAX_LIMIT = 200
const OUTPUT_CHARS = 6000

const OPTIONS = {
  limit: { type: 'string' },
  reads: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

export const blame = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  const path = textOf(positionals, 'blame needs a file path, or the end of one')
  const limit = integer('limit', values.limit, 1, MAX_LIMIT, 20)

  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  const { store } = opened
  try {
    const rows: Blame[] = store.fileUses(path, { reads: values.reads === true, limit }).map(use => ({ ...use, asked: store.askedBefore(use.session, use.first) }))
    io.stdout(values.json === true ? `${JSON.stringify({ path, sessions: rows }, null, 2)}\n` : `${formatBlame(rows, path, { maxChars: OUTPUT_CHARS })}\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
