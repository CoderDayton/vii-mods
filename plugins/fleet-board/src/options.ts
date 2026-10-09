// The plugin's options. A working session that has not changed state for the quiet time gets a mark in the pane.
export type Config = { quietMs: number }

const DEFAULT_QUIET = 30
const MIN_QUIET = 5
const MAX_QUIET = 600

const clamped = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => ({
  quietMs: clamped(o['quietMinutes'], DEFAULT_QUIET, MIN_QUIET, MAX_QUIET) * 60_000,
})
