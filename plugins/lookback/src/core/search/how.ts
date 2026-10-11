import { NO_COMMAND } from '../call'
import type { CommandUse } from '../types'
import { dateOf, folderOf, snippetOf } from './format'

const COMMAND_WIDTH = 300

// Commands one per line: how often each ran, the day of its latest run, the project of that run, the command.
export const formatCommands = (commands: readonly CommandUse[]): string => {
  if (commands.length === 0) return NO_COMMAND
  const runs = Math.max(...commands.map(c => String(c.runs).length))
  const folder = Math.max(...commands.map(c => folderOf(c.project).length))
  return commands.map(c => `${String(c.runs).padStart(runs)}×  ${dateOf(c.last)}  ${folderOf(c.project).padEnd(folder)}  ${snippetOf(c.text, [], COMMAND_WIDTH)}`).join('\n')
}
