import { parseArgs } from 'node:util'

import type { Config } from '../../runtime/config'
import { EXIT } from '../io'
import type { ExitCode, Io } from '../io'
import { openForReading } from '../open'

const OPTIONS = { json: { type: 'boolean' } } as const

export const stats = async (argv: string[], io: Io, config: Config): Promise<ExitCode> => {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
  const opened = openForReading(config, io)
  if ('code' in opened) return opened.code
  try {
    const s = opened.store.stats()
    if (values.json === true) {
      io.stdout(`${JSON.stringify({ path: config.databasePath, ...s }, null, 2)}\n`)
      return EXIT.ok
    }
    const kinds = Object.entries(s.byKind)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ')
    const model = s.model === null ? 'none' : `${s.model}, ${s.dimension} values each`
    const rows: [string, string | number][] = [
      ['index', config.databasePath],
      ['entries', s.entries],
      ['sessions', s.sessions],
      ['agents', s.agents],
      ['vectors', s.chunks],
      ['model', model],
      ['kinds', kinds],
      ['files', s.files],
      ['redacted', s.redacted],
      ['forgotten', opened.store.forgotten().length],
    ]
    io.stdout(`${rows.map(([label, value]) => `${label.padEnd(10)}${value}`).join('\n')}\n`)
    return EXIT.ok
  } finally {
    opened.store.close()
  }
}
