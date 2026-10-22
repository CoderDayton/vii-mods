import { parseArgs } from 'node:util'

import { KEEP_MS, runKeeper } from '../../runtime/captions/keeper'
import type { Config } from '../../runtime/config'
import { EXIT, UsageError } from '../io'
import type { ExitCode, Io } from '../io'

const OPTIONS = {
  state: { type: 'string' },
  command: { type: 'string' },
  idle: { type: 'string' },
} as const

export const keeper = async (argv: string[], _io: Io, _config: Config): Promise<ExitCode> => {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
  if (values.state === undefined || values.command === undefined) throw new UsageError('keeper needs --state and --command')
  const idleMs = Number(values.idle ?? KEEP_MS)
  if (!Number.isFinite(idleMs) || idleMs <= 0) throw new UsageError('keeper --idle must be a positive number of milliseconds')
  await runKeeper({ statePath: values.state, command: values.command, idleMs })
  return EXIT.ok
}
