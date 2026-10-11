import { configFrom } from '../runtime/config'
import { blame } from './commands/blame'
import { doctor } from './commands/doctor'
import { files } from './commands/files'
import { fix } from './commands/fix'
import { forget } from './commands/forget'
import { how } from './commands/how'
import { index } from './commands/index'
import { search } from './commands/search'
import { show } from './commands/show'
import { stats } from './commands/stats'
import { EXIT, UsageError } from './io'
import type { ExitCode, Io } from './io'
import { USAGE } from './usage'

const COMMANDS = { index, search, show, fix, how, blame, files, forget, stats, doctor } as const

const isCommand = (name: string): name is keyof typeof COMMANDS => Object.hasOwn(COMMANDS, name)

// A flag the command does not know, as `node:util` reports it.
const isParseError = (error: unknown): error is Error => (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS') === true

export const main = async (argv: readonly string[], io: Io): Promise<ExitCode> => {
  const [name, ...rest] = argv
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.stdout(USAGE)
    return name === undefined ? EXIT.usage : EXIT.ok
  }
  try {
    if (!isCommand(name)) throw new UsageError(`unknown command "${name}"`)
    return await COMMANDS[name]([...rest], io, configFrom(io.env))
  } catch (error) {
    if (error instanceof UsageError || isParseError(error)) {
      io.stderr(`lookback: ${(error as Error).message}\n\n${USAGE}`)
      return EXIT.usage
    }
    io.stderr(`lookback: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT.failed
  }
}
