import { parseArgs } from 'node:util'

import { dateOf, folderOf } from '../../core/search/format'
import type { Config } from '../../runtime/config'
import { UsageError, EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading, openForWriting } from '../open'
import { oneSession } from '../sessions'

const OPTIONS = {
  list: { type: 'boolean' },
  undo: { type: 'string' },
} as const

const list = (io: Io, config: Config): ExitCode => {
  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  try {
    const gone = opened.store.forgotten()
    io.stdout(gone.length === 0 ? 'No session is forgotten.\n' : `${gone.map(f => `${f.session}  ${folderOf(f.project)}  forgotten ${dateOf(f.at)}`).join('\n')}\n`)
    return EXIT.ok
  } finally {
    opened.store.close()
  }
}

// Removes one session from the index for good: an index run does not read it back until `--undo`.
export const forget = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  if (values.list === true) return list(io, config)
  const prefix = (values.undo ?? positionals.join(' ')).trim()
  if (prefix === '') throw new UsageError('forget needs a session id, or the start of one')

  const store = await openForWriting(config)
  try {
    if (values.undo !== undefined) {
      const matches = store.forgotten().filter(f => f.session.startsWith(prefix))
      const only = matches.length === 1 ? matches[0] : undefined
      if (only === undefined) {
        io.stderr(`lookback: ${matches.length === 0 ? 'no' : matches.length} forgotten ${matches.length === 1 ? 'session starts' : 'sessions start'} with "${prefix}"\n`)
        return EXIT.failed
      }
      store.unforget(only.session)
      io.stdout(`Session ${only.session} is no longer forgotten. Run "lookback index" to read it back.\n`)
      return EXIT.ok
    }
    const session = oneSession(store, prefix, io)
    if (session === null) return EXIT.failed
    const removed = store.forget(session.session, io.now())
    io.stdout(`Forgot session ${session.session}: ${removed} ${removed === 1 ? 'entry' : 'entries'} removed. It stays out of the index; "lookback forget --undo ${session.session.slice(0, 8)}" brings it back.\n`)
    return EXIT.ok
  } finally {
    store.close()
  }
}
