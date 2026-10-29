export type Rewrite = { kind: 'none' } | { kind: 'deny'; reason: string } | { kind: 'run'; command: string }

export type Options = { askpass: string; cache: boolean; timeout: number }

const SHOWN_MAX = 600
const BREAKS = new Set([';', '&', '|', '(', ')', '\n', '`'])
// sudo's short options that take a value, and its long ones.
const VALUE_SHORT = new Set('ugCDhprtTUR')
const VALUE_LONG = new Set([
  '--user', '--group', '--chdir', '--chroot', '--host', '--prompt', '--role', '--type',
  '--command-timeout', '--other-user', '--close-from', '--login-class',
])
// Options that need a password even with no command after them.
const AUTH_SHORT = new Set('isvle')

const quote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\r'

/** End of the shell word starting at `i`, honouring quotes and backslashes. */
const wordEnd = (s: string, i: number): number => {
  let q = ''
  for (; i < s.length; i++) {
    const c = s[i] as string
    if (q === "'") {
      if (c === "'") q = ''
    } else if (c === '\\') {
      i++
    } else if (q === '"') {
      if (c === '"') q = ''
    } else if (c === "'" || c === '"') {
      q = c
    } else if (isSpace(c) || BREAKS.has(c)) {
      return i
    }
  }
  return i
}

/** Index just past each `sudo` that is the command of its own simple command. */
const sudoSites = (s: string): number[] => {
  const sites: number[] = []
  let atCommand = true
  let i = 0
  while (i < s.length) {
    const c = s[i] as string
    if (isSpace(c)) {
      i++
    } else if (BREAKS.has(c)) {
      atCommand = true
      i++
    } else {
      const end = Math.max(wordEnd(s, i), i + 1)
      const word = s.slice(i, end)
      if (atCommand && !/^[A-Za-z_]\w*=/.test(word)) {
        if (word === 'sudo') sites.push(end)
        atCommand = false
      }
      i = end
    }
  }
  return sites
}

type Flags = { stdin: boolean; chosen: boolean; needsAuth: boolean }

/** Reads the options after a `sudo` ending at `p` up to its command. */
const readFlags = (s: string, p: number): Flags => {
  const f: Flags = { stdin: false, chosen: false, needsAuth: false }
  let i = p
  let skip = false
  for (;;) {
    while (i < s.length && isSpace(s[i] as string)) i++
    if (i >= s.length || BREAKS.has(s[i] as string)) return f
    const end = Math.max(wordEnd(s, i), i + 1)
    const t = s.slice(i, end)
    i = end
    if (skip) {
      skip = false
      continue
    }
    if (t === '--' || !t.startsWith('-')) {
      f.needsAuth = true
      return f
    }
    if (t.startsWith('--')) {
      const name = t.split('=')[0] as string
      if (name === '--stdin') f.stdin = true
      if (name === '--askpass' || name === '--non-interactive') f.chosen = true
      if (['--login', '--shell', '--validate', '--list', '--edit'].includes(name)) f.needsAuth = true
      if (VALUE_LONG.has(name) && !t.includes('=')) skip = true
      continue
    }
    for (let k = 1; k < t.length; k++) {
      const ch = t[k] as string
      if (ch === 'S') f.stdin = true
      if (ch === 'A' || ch === 'n') f.chosen = true
      if (AUTH_SHORT.has(ch)) f.needsAuth = true
      if (VALUE_SHORT.has(ch)) {
        skip = k === t.length - 1
        break
      }
    }
  }
}

const shown = (command: string): string =>
  command.length > SHOWN_MAX ? `${command.slice(0, SHOWN_MAX - 3)}...` : command

export const rewriteSudo = (command: string, opts: Options): Rewrite => {
  const insert = opts.cache ? ' -A' : ' -k -A'
  let out = command
  let changed = false
  for (const p of sudoSites(command).reverse()) {
    const f = readFlags(command, p)
    if (f.stdin) {
      return {
        kind: 'deny',
        reason: 'sudo -S reads the password from stdin. Drop -S: a dialog asks the user for the password.',
      }
    }
    if (f.chosen || !f.needsAuth) continue
    out = out.slice(0, p) + insert + out.slice(p)
    changed = true
  }
  if (!changed) return { kind: 'none' }
  const env = [
    `export SUDO_ASKPASS=${quote(opts.askpass)}`,
    `export CLAUDE_SUDO_CMD=${quote(shown(command))}`,
    `export CLAUDE_SUDO_TIMEOUT=${quote(String(opts.timeout))}`,
  ]
  return { kind: 'run', command: `${env.join('; ')}; ${out}` }
}
