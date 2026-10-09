import { expect, test } from 'claude-code/testing'

import { appendArgv, buildEntry, hasAttachments, historyPathOf, learnShape, tailArgv } from '../src/history'

const line = (o: Record<string, unknown>) => JSON.stringify(o)

const REAL = (display: string, t: number) =>
  line({ display, pastedContents: {}, timestamp: t, project: '/p', sessionId: 's1' })

const INPUT = { text: 'my original draft', now: 1_791_000_000_000, project: '/work', sessionId: 'abc-123' }

test('the shape is learned from the entries the file ends with', () => {
  const tail = [REAL('one', 1), REAL('two', 2)].join('\n')
  const shape = learnShape(tail)
  expect(shape).not.toBeNull()
  expect(Object.keys(shape?.template ?? {})).toEqual(['display', 'pastedContents', 'timestamp', 'project', 'sessionId'])
})

test('a first line cut by tail, blank lines and junk are skipped', () => {
  const tail = ['ssage":"cut off mid-line"}', '', 'not json', '[1,2]', REAL('kept', 5)].join('\n')
  expect(Object.keys(learnShape(tail)?.template ?? {}).length).toBe(5)
})

test('no usable entry, or one without display and timestamp, means no shape', () => {
  expect(learnShape('')).toBeNull()
  expect(learnShape('garbage\nmore garbage')).toBeNull()
  expect(learnShape(line({ display: 'x', project: '/p' }))).toBeNull()
  expect(learnShape(line({ timestamp: 1, project: '/p' }))).toBeNull()
  expect(learnShape(line({ display: 4, timestamp: 1 }))).toBeNull()
  expect(learnShape(line({ display: 'x', timestamp: 'now' }))).toBeNull()
})

test('the commonest set of keys wins over a one-off entry', () => {
  const odd = line({ display: 'odd', timestamp: 9, extra: true })
  const tail = [REAL('a', 1), REAL('b', 2), REAL('c', 3), odd].join('\n')
  expect(Object.keys(learnShape(tail)?.template ?? {})).toContain('sessionId')
  expect(Object.keys(learnShape(tail)?.template ?? {})).not.toContain('extra')
})

test('an entry is built from the shape with the draft, the time, the folder and the session', () => {
  const shape = learnShape(REAL('x', 1))
  if (shape === null) throw new Error('no shape')
  const built = JSON.parse(buildEntry(shape, INPUT)) as Record<string, unknown>
  expect(built).toEqual({
    display: 'my original draft',
    pastedContents: {},
    timestamp: 1_791_000_000_000,
    project: '/work',
    sessionId: 'abc-123',
  })
  expect(Object.keys(built)).toEqual(['display', 'pastedContents', 'timestamp', 'project', 'sessionId'])
})

test('an entry is one line, whatever the draft holds', () => {
  const shape = learnShape(REAL('x', 1))
  if (shape === null) throw new Error('no shape')
  const built = buildEntry(shape, { ...INPUT, text: 'line one\nline two\t"quoted" \\ back' })
  expect(built.includes('\n')).toBe(false)
  expect((JSON.parse(built) as { display: string }).display).toBe('line one\nline two\t"quoted" \\ back')
})

test('a key the file has and we do not know gets an empty value of its type', () => {
  const next = line({
    display: 'x', pastedContents: {}, timestamp: 1, project: '/p', sessionId: 's',
    model: 'sonnet', tokens: 12, flags: ['a'], meta: { a: 1 }, seen: true, note: null,
  })
  const shape = learnShape(next)
  if (shape === null) throw new Error('no shape')
  const built = JSON.parse(buildEntry(shape, INPUT)) as Record<string, unknown>
  expect(built['model']).toBe('')
  expect(built['tokens']).toBe(0)
  expect(built['flags']).toEqual([])
  expect(built['meta']).toEqual({})
  expect(built['seen']).toBe(false)
  expect(built['note']).toBeNull()
  expect(built['display']).toBe('my original draft')
})

test('a key the file no longer has is not written', () => {
  const shape = learnShape(line({ display: 'x', timestamp: 1, project: '/p' }))
  if (shape === null) throw new Error('no shape')
  expect(JSON.parse(buildEntry(shape, INPUT))).toEqual({ display: 'my original draft', timestamp: 1_791_000_000_000, project: '/work' })
})

test('pasted text and image placeholders are spotted, plain text is not', () => {
  expect(hasAttachments('see [Pasted text #1 +20 lines] please')).toBe(true)
  expect(hasAttachments('[Pasted text #8]')).toBe(true)
  expect(hasAttachments('look at [Image #2]')).toBe(true)
  expect(hasAttachments('a [bracketed] note and #3')).toBe(false)
  expect(hasAttachments('make a calculator')).toBe(false)
})

test('the history file sits in the config directory', () => {
  expect(historyPathOf('/home/vii/.claude')).toBe('/home/vii/.claude/history.jsonl')
})

test('the tail command reads the last entries of the file', () => {
  expect(tailArgv('/h/history.jsonl')).toEqual(['tail', '-n', '30', '/h/history.jsonl'])
})

test('the append command takes the path and the line as arguments and checks the file first', () => {
  const argv = appendArgv('/h/history.jsonl', '{"a":1}')
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv[3]).toBe('rescribe-history')
  expect(argv[4]).toBe('/h/history.jsonl')
  expect(argv[5]).toBe('{"a":1}')
  const script = argv[2] ?? ''
  expect(script).toContain('>>')
  expect(script).toContain('exit 2')
  expect(script).not.toContain('{"a":1}')
})
