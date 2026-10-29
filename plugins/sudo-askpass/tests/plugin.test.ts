import { expect, test } from 'claude-code/testing'

const bash = (command: string) => ({ tool: 'Bash' as const, tool_use_id: 'tu1', command }) as never

const ok = { result: { stdout: '', stderr: '', interrupted: false } as never, text: 'done' }

test('a sudo call reaches the tool with the askpass helper and a fresh-password flag', async ($, on) => {
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok
  })
  await $.tool.call(bash('sudo apt update'))
  const command = seen[0] ?? ''
  expect(command).toMatch(/^export SUDO_ASKPASS='[^']*\/bin\/askpass\.sh'; /)
  expect(command).toContain('sudo -k -A apt update')
})

test('a command without sudo reaches the tool untouched', async ($, on) => {
  const seen: string[] = []
  on('tool.call', (_$, e) => {
    seen.push((e as { command: string }).command)
    return ok
  })
  await $.tool.call(bash('ls -la'))
  expect(seen).toEqual(['ls -la'])
})

test('sudo -S is refused with the reason, and the tool never runs', async ($, on) => {
  let ran = false
  on('tool.call', () => {
    ran = true
    return ok
  })
  const r = await $.tool.call(bash('echo pw | sudo -S true'))
  expect('deny' in r ? r.deny : '').toContain('sudo-askpass: sudo -S reads the password from stdin')
  expect(ran).toBe(false)
})
