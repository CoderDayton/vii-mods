// What a command needs from the process around it, so tests can give it their own.
export type Io = {
  env: Readonly<Record<string, string | undefined>>
  stdout: (text: string) => void
  stderr: (text: string) => void
  now: () => number
}

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  noIndex: 3,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

// A bad command line: the message is printed with the usage, and the exit code is EXIT.usage.
export class UsageError extends Error {
  override readonly name = 'UsageError'
}
