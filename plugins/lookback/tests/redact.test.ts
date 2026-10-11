import { expect, test } from 'claude-code/testing'

import { redact } from '../src/core/text/redact'
import { entriesOf } from '../src/core/transcript/entries'

// Made up here so that no line of this file holds something a secret scanner would report.
const body = (n: number): string => 'a1B2c3D4e5F6g7H8i9J0'.repeat(4).slice(0, n)

test('keys of well-known services are replaced by a marker that names the kind', () => {
  const cases: [string, string][] = [
    [`ghp_${body(36)}`, 'github-token'],
    [`github_pat_${body(40)}`, 'github-token'],
    [`sk-ant-${body(40)}`, 'anthropic-key'],
    [`sk-proj-${body(40)}`, 'openai-key'],
    [`AKIA${'ABCDEFGH12345678'}`, 'aws-key'],
    [`xoxb-${body(24)}`, 'slack-token'],
    [`AIza${body(35)}`, 'google-key'],
    [`sk_live_${body(24)}`, 'stripe-key'],
    [`eyJ${body(12)}.eyJ${body(20)}.${body(20)}`, 'jwt'],
  ]
  for (const [secret, kind] of cases) {
    const out = redact(`before ${secret} after`)
    expect(out).toBe(`before [redacted:${kind}] after`)
  }
})

test('a private key block is cut whole, also one that has no end', () => {
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${body(60)}\n${body(60)}\n-----END OPENSSH PRIVATE KEY-----`
  expect(redact(`key:\n${key}\ndone`)).toBe('key:\n[redacted:private-key]\ndone')
  expect(redact(`-----BEGIN RSA PRIVATE KEY-----\n${body(40)}`)).toBe('[redacted:private-key]')
})

test('a bearer token and a password in a URL go, and what names them stays', () => {
  expect(redact(`Authorization: Bearer ${body(30)}`)).toBe('Authorization: Bearer [redacted:bearer]')
  expect(redact(`postgres://admin:${body(12)}@db.internal:5432/app`)).toBe('postgres://admin:[redacted:password]@db.internal:5432/app')
})

test('a value given to a name that says secret goes, and the name stays', () => {
  expect(redact(`API_KEY=${body(24)}`)).toBe('API_KEY=[redacted:secret]')
  expect(redact(`"client_secret": "${body(24)}"`)).toBe('"client_secret": "[redacted:secret]"')
  expect(redact(`export DB_PASSWORD='${body(16)}'`)).toBe("export DB_PASSWORD='[redacted:secret]'")
})

test('code that only talks about tokens and keys is left as it is', () => {
  for (const text of [
    'const token = getToken(request)',
    'max_tokens=4096',
    'password: string',
    'api_key = os.environ["API_KEY"]',
    'the secret is that tests come first',
    'token_count = 12',
    'sk-learn is a library',
    'see https://example.com/docs?page=2',
  ]) {
    expect(redact(text)).toBe(text)
  }
})

test('what is read from a transcript is redacted before it becomes an entry', () => {
  const row = (content: unknown, type = 'user') => JSON.stringify({ type, sessionId: 's1', cwd: '/w', timestamp: '2026-10-09T10:00:00.000Z', message: { content } })
  expect(entriesOf(row(`my key is ghp_${body(36)}`))[0]?.text).toBe('my key is [redacted:github-token]')
  const cmd = row([{ type: 'tool_use', name: 'Bash', input: { command: `curl -H "Authorization: Bearer ${body(30)}" https://api` } }], 'assistant')
  expect(entriesOf(cmd)[0]?.text).toBe('curl -H "Authorization: Bearer [redacted:bearer]" https://api')
})
