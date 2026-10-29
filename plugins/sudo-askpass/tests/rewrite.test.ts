import { expect, test } from 'claude-code/testing'

import { rewriteSudo } from '../src/rewrite'

const OPTS = { askpass: '/m/bin/askpass.sh', cache: false, timeout: 120 }

const run = (command: string, opts = OPTS): string => {
  const out = rewriteSudo(command, opts)
  if (out.kind !== 'run') throw new Error(`expected run, got ${out.kind}: ${command}`)
  return out.command
}

const PREFIX = /^(export [A-Z_]+='(?:[^']|'\\'')*'; ){3}/

const body = (command: string, opts = OPTS): string => run(command, opts).replace(PREFIX, '')

test('leaves commands without a sudo call alone', () => {
  for (const c of [
    'ls',
    'echo sudo',
    'grep "sudo apt" notes.txt',
    "echo 'a; sudo b'",
    'visudo -c',
    'sudoedit /etc/hosts',
    'ls /usr/bin/sudo',
    'sudo',
  ]) {
    expect(rewriteSudo(c, OPTS).kind).toBe('none')
  }
})

test('rewrites a plain sudo call to ask for a fresh password', () => {
  expect(body('sudo apt update')).toBe('sudo -k -A apt update')
})

test('exports the helper, the original command and the timeout first', () => {
  const c = run('sudo apt update')
  expect(c.startsWith("export SUDO_ASKPASS='/m/bin/askpass.sh'; ")).toBe(true)
  expect(c).toContain("export CLAUDE_SUDO_CMD='sudo apt update'; ")
  expect(c).toContain("export CLAUDE_SUDO_TIMEOUT='120'; ")
})

test('cache mode keeps sudo own cached login', () => {
  expect(body('sudo apt update', { ...OPTS, cache: true })).toBe('sudo -A apt update')
})

test('finds sudo after && ; | & ( $( and newlines', () => {
  expect(body('ls && sudo a')).toBe('ls && sudo -k -A a')
  expect(body('ls; sudo a')).toBe('ls; sudo -k -A a')
  expect(body('cat f | sudo tee /etc/x')).toBe('cat f | sudo -k -A tee /etc/x')
  expect(body('x & sudo a')).toBe('x & sudo -k -A a')
  expect(body('(sudo a)')).toBe('(sudo -k -A a)')
  expect(body('echo $(sudo a)')).toBe('echo $(sudo -k -A a)')
  expect(body('a\nsudo b')).toBe('a\nsudo -k -A b')
})

test('rewrites every sudo in a chain', () => {
  expect(body('sudo a; sudo b')).toBe('sudo -k -A a; sudo -k -A b')
})

test('keeps variable assignments before sudo', () => {
  expect(body('FOO=1 sudo env')).toBe('FOO=1 sudo -k -A env')
})

test('keeps sudo options after the inserted flags', () => {
  expect(body('sudo -u root id')).toBe('sudo -k -A -u root id')
})

test('ignores sudo inside quotes', () => {
  expect(rewriteSudo('echo "x; sudo y"', OPTS).kind).toBe('none')
  expect(rewriteSudo("echo 'x && sudo y'", OPTS).kind).toBe('none')
})

test('leaves a call alone when the caller already chose how to authenticate', () => {
  for (const c of ['sudo -n true', 'sudo -A true', 'sudo --askpass true', 'sudo -k', 'sudo -K', 'sudo --non-interactive id']) {
    expect(rewriteSudo(c, OPTS).kind).toBe('none')
  }
})

test('refuses sudo -S, which reads the password from stdin', () => {
  for (const c of ['sudo -S true', 'echo pw | sudo --stdin apt', 'sudo -nS id', 'ls && sudo -S x']) {
    const out = rewriteSudo(c, OPTS)
    expect(out.kind).toBe('deny')
  }
})

test('does not mistake a value for the -S flag', () => {
  expect(body('sudo -u Sam id')).toBe('sudo -k -A -u Sam id')
  expect(body('sudo -uS id')).toBe('sudo -k -A -uS id')
})

test('quotes a single quote in the shown command', () => {
  expect(run("sudo sh -c 'echo hi'")).toContain("export CLAUDE_SUDO_CMD='sudo sh -c '\\''echo hi'\\'''; ")
})

test('shortens a very long command in the dialog', () => {
  const c = run(`sudo echo ${'x'.repeat(2000)}`)
  const shown = /CLAUDE_SUDO_CMD='([^']*)'/.exec(c)?.[1] ?? ''
  expect(shown.length).toBeLessThan(700)
  expect(shown.endsWith('...')).toBe(true)
})
