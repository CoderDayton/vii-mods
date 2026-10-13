import { parseArgs } from 'node:util'

import { formatBlame, formatFileNote } from '../../core/search/blame'
import type { Blame } from '../../core/search/blame'
import type { Config } from '../../runtime/config'
import { integer, textOf } from '../args'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const MAX_LIMIT = 200
const OUTPUT_CHARS = 6000
const NOTE_SESSIONS = 3
const NOTE_SCAN = 50

const OPTIONS = {
  limit: { type: 'string' },
  reads: { type: 'boolean' },
  brief: { type: 'boolean' },
  min: { type: 'string' },
  exclude: { type: 'string', default: '' },
  project: { type: 'string' },
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
    const brief = values.brief === true
    const skip = values.exclude ?? ''
    const uses = store.fileUses(path, { reads: values.reads === true, limit: brief ? NOTE_SCAN : limit, within: values.project })
    const kept = brief ? uses.filter(use => use.parent === undefined && use.session !== skip) : uses
    const rows: Blame[] = kept.map((use, i) => ({ ...use, asked: brief && i >= NOTE_SESSIONS ? null : store.askedBefore(use.session, use.first) }))
    if (brief) {
      const note = formatFileNote(rows, { min: integer('min', values.min, 1, NOTE_SCAN, 2), shown: NOTE_SESSIONS })
      if (note !== '') io.stdout(`${note}\n`)
      return EXIT.ok
    }
    io.stdout(values.json === true ? `${JSON.stringify({ path, sessions: rows }, null, 2)}\n` : `${formatBlame(rows, path, { maxChars: OUTPUT_CHARS })}\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
