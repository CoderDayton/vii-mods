import { expect, test } from 'claude-code/testing'

import { appendArgv, historyPathOf, HISTORY_KEEP, HISTORY_TRIM_AT, MIN_GAP_MS } from '../src/histfile'

test('the history file sits beside the lock file', () => {
  expect(historyPathOf('/tmp/gpu-lock/lock')).toBe('/tmp/gpu-lock/history.jsonl')
  expect(historyPathOf('lock')).toBe('./history.jsonl')
})

test('an append is one sh call that carries the file, the time and the line as arguments', () => {
  const argv = appendArgv('/tmp/gpu-lock/lock', '{"at":5}', 5)
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv.slice(3)).toEqual(['gpu-lock-history', '/tmp/gpu-lock/history.jsonl', '5', '{"at":5}'])
  expect(argv[2]).not.toContain('{"at":5}')
})

test('the script takes the lock, checks the gap, and trims in place', () => {
  const script = appendArgv('/x/lock', 'x', 1)[2] ?? ''
  expect(script).toContain('flock -w 2 9')
  expect(script).toContain(`-lt ${MIN_GAP_MS}`)
  expect(script).toContain(`-gt ${HISTORY_TRIM_AT}`)
  expect(script).toContain(`tail -n ${HISTORY_KEEP}`)
  expect(script).not.toContain('mv ')
})

test('a time with anything but digits is passed to the script as text, never run', () => {
  expect(appendArgv('/x/lock', 'x', 12.9)[5]).toBe('12')
})
