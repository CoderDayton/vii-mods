import type { Config } from './fleet'
import type { LauncherOption } from './launch'

const LAUNCHERS: readonly LauncherOption[] = ['auto', 'ghostty', 'wezterm', 'tmux', 'tmux-pane', 'wezterm-pane']
const DEFAULT_QUIET = 30
const MIN_QUIET = 5
const MAX_QUIET = 600
const WAIT_MS = 60_000

const clamped = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const launcher = typeof o['launcher'] === 'string' ? o['launcher'].trim().toLowerCase() : ''
  return {
    launcher: LAUNCHERS.find(l => l === launcher) ?? 'auto',
    claudeArgs: typeof o['claudeArgs'] === 'string' ? o['claudeArgs'].trim() : '',
    quietMs: clamped(o['quietMinutes'], DEFAULT_QUIET, MIN_QUIET, MAX_QUIET) * 60_000,
    waitMs: WAIT_MS,
  }
}
