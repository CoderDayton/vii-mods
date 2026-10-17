import { expect, test } from 'claude-code/testing'

import { FIX_TAG, RECALL_TAG, argvOf, askedArgv, captionNotice, cliEnv, commandArgv, commandText, fixContext, recallArgv, recallContext, requestOf, shownIds } from '../src/core/call'

test('a question about the past is recalled for the session asking, and a result of this session is read', () => {
  expect(askedArgv('--did you rebuild it?', 'me')).toEqual(['recall', '--asked', '--session', 'me', '--', '--did you rebuild it?'])
  expect(shownIds('2026-10-09  claude-mods  d18dbf28  this session, earlier  Fleet mod\n  assistant Rebuilt.')).toEqual(['d18dbf28'])
  expect(recallContext('x')).toContain('"this session, earlier" is from this session')
})

test('the recall of a prompt names its folder, the session to leave out and what was shown', () => {
  expect(recallArgv('move it', '/work', 'me', new Set())).toEqual(['recall', '--project', '/work', '--exclude', 'me', '--', 'move it'])
  expect(recallArgv('--odd', '/work', 'me', new Set(['d18dbf28', '45b0ec34']))).toEqual(['recall', '--project', '/work', '--exclude', 'me', '--skip', 'd18dbf28,45b0ec34', '--', '--odd'])
})

test('the sessions a block of results shows are read from its headings', () => {
  const found = '2026-10-09  claude-mods  d18dbf28  Fix the brackets\n  asked     the brackets\n\n2026-10-01  my app  45b0ec34  sub-agent of aaaa1111\n  said      done'
  expect(shownIds(found)).toEqual(['d18dbf28', '45b0ec34'])
  expect(shownIds('')).toEqual([])
})

test('a search request needs a question, and keeps the filters it was given', () => {
  expect(requestOf({ query: ' deploy rollback ', project: 'api', since: '30d', limit: 3 })).toEqual({
    query: 'deploy rollback',
    project: 'api',
    since: '30d',
    limit: 3,
  })
  expect(requestOf({ query: 'x' })).toEqual({ query: 'x' })
})

test('a request with no question or of the wrong shape is refused with a reason', () => {
  for (const bad of [null, 'text', {}, { query: '' }, { query: '   ' }, { query: 7 }]) {
    expect(requestOf(bad)).toEqual({ error: expect.stringContaining('query') })
  }
  expect(requestOf({ query: 'x', since: 'soon' })).toEqual({ error: expect.stringContaining('since') })
  expect(requestOf({ query: 'x', limit: 'many' })).toEqual({ error: expect.stringContaining('limit') })
  expect(requestOf({ query: 'x', mode: 'restore' })).toEqual({ error: expect.stringContaining('mode') })
  expect(requestOf({ query: 'x', offset: -1 })).toEqual({ error: expect.stringContaining('offset') })
})

test('a request for one session needs no question', () => {
  expect(requestOf({ session: ' d18dbf28 ', offset: 40 })).toEqual({ query: '', session: 'd18dbf28', offset: 40 })
  expect(requestOf({ session: '' })).toEqual({ error: expect.stringContaining('query') })
})

test('the command line puts the question after a double dash, so a leading dash is not a flag', () => {
  expect(argvOf({ query: '--help me' }, { limit: 5 })).toEqual(['search', '--limit', '5', '--', '--help me'])
})

test('filters, the page, the session to leave out and keyword mode become flags', () => {
  expect(argvOf({ query: 'q', project: 'api', since: '2w', limit: 3, offset: 6 }, { limit: 5, exclude: 'abc', keyword: true })).toEqual([
    'search',
    '--limit',
    '3',
    '--offset',
    '6',
    '--project',
    'api',
    '--since',
    '2w',
    '--exclude',
    'abc',
    '--keyword',
    '--',
    'q',
  ])
})

test('a mode picks the command, and a session id opens that session', () => {
  expect(argvOf({ query: 'q' }, { limit: 5, exclude: 'me', ownTurns: true })).toEqual(['search', '--limit', '5', '--own', 'me', '--', 'q'])
  expect(argvOf({ query: 'ENOENT', mode: 'fix' }, { limit: 5, exclude: 'me', ownTurns: true })).toEqual(['fix', '--limit', '5', '--exclude', 'me', '--', 'ENOENT'])
  expect(argvOf({ query: 'ENOENT', mode: 'fix', project: 'api' }, { limit: 5, exclude: 'me' })).toEqual(['fix', '--limit', '5', '--project', 'api', '--exclude', 'me', '--', 'ENOENT'])
  expect(argvOf({ query: 'bun test', mode: 'how' }, { limit: 5, exclude: 'me' })).toEqual(['how', '--exclude', 'me', '--', 'bun test'])
  expect(argvOf({ query: '', session: 'd18dbf28', offset: 40 }, { limit: 5, exclude: 'me' })).toEqual(['show', '--offset', '40', '--', 'd18dbf28'])
  expect(argvOf({ query: 'src/store.ts', mode: 'blame', project: 'api', limit: 3 }, { limit: 5, exclude: 'me' })).toEqual(['blame', '--', 'src/store.ts'])
  expect(requestOf({ query: 'src/store.ts', mode: 'blame' })).toEqual({ query: 'src/store.ts', mode: 'blame' })
})

test('/lookback reads its first word as a command only when the rest fits it', () => {
  const argv = (args: string) => commandArgv(args, 5, 'me')
  expect(argv('')).toEqual(['stats'])
  expect(argv('doctor')).toEqual(['doctor'])
  expect(argv('index')).toEqual(['index', '--quiet', '--wait'])
  expect(argv('recent')).toEqual(['recent', '--limit', '10'])
  expect(argv('recent changes to the parser')[0]).toBe('search')
  expect(argv('show d18dbf28')).toEqual(['show', '--offset', '0', '--', 'd18dbf28'])
  expect(argv('show d18dbf28 60')).toEqual(['show', '--offset', '60', '--', 'd18dbf28'])
  expect(argv('forget d18dbf28-1111')).toEqual(['forget', '--', 'd18dbf28-1111'])
  expect(argv('forget --list')).toEqual(['forget', '--list'])
  expect(argv('forget --undo d18dbf28')).toEqual(['forget', '--undo', 'd18dbf28'])
  expect(argv('fix ModuleNotFoundError PIL').slice(0, 1)).toEqual(['fix'])
  expect(argv('how run tests').at(-1)).toBe('run tests')
  expect(argv('how run tests')[0]).toBe('how')
  expect(argv('blame src/store.ts')).toEqual(['blame', '--', 'src/store.ts'])
  expect(argv('files d18dbf28')).toEqual(['files', '--', 'd18dbf28'])
  expect(argv('files in the repo').slice(0, 1)).toEqual(['search'])
  expect(argv('blame the parser for this').slice(0, 1)).toEqual(['search'])
})

test('/lookback shows what a command said on stderr beside its answer, without the repeated name', () => {
  expect(commandText({ code: 0, out: 'Read 2 transcripts.', err: 'lookback: embedding stopped (down); keyword search still works' })).toBe(
    'Read 2 transcripts.\nembedding stopped (down); keyword search still works',
  )
  expect(commandText({ code: 0, out: 'Found.', err: '' })).toBe('Found.')
  expect(commandText({ code: 0, out: '', err: 'lookback: no session starts with "abc"' })).toBe('no session starts with "abc"')
  expect(commandText({ code: 1, out: '', err: 'lookback: boom' })).toBe('boom')
  expect(commandText({ code: 3, out: '', err: '' })).toBe('lookback exited with 3')
})

test('a background index run raises the caption failure alone, since a missing embedding server is common', () => {
  expect(captionNotice('lookback: embedding stopped (x); keyword search still works\nlookback: image captions stopped (no server); the images wait for the next run')).toBe(
    'lookback: image captions stopped (no server); the images wait for the next run',
  )
  expect(captionNotice('lookback: embedding stopped (x); keyword search still works')).toBeNull()
  expect(captionNotice('')).toBeNull()
})

test('/lookback searches for anything else, also when it starts with a command word', () => {
  const argv = (args: string) => commandArgv(args, 5, 'me')
  expect(argv('bracket fix')).toEqual(['search', '--limit', '5', '--exclude', 'me', '--', 'bracket fix'])
  expect(argv('show me the deploy steps').slice(0, 1)).toEqual(['search'])
  expect(argv('forget about the old plan').at(-1)).toBe('forget about the old plan')
  expect(argv('index of the parser').slice(0, 1)).toEqual(['search'])
  expect(argv('fix')).toEqual(['search', '--limit', '5', '--exclude', 'me', '--', 'fix'])
})

test('the settings reach the command line as environment variables', () => {
  const options = { limit: 5, autoRecall: true, autoIndex: true, errorHints: true, sessionDigest: true, fileNotes: true, fileTools: 'mcp__files', embeddingModel: 'm', embeddingUrl: 'http://h/v1' }
  expect(cliEnv({ ...options, captionServer: 'llama-server -m v.gguf', captionModel: 'vl', captionUrl: 'http://h:8080/v1' })).toEqual({
    LOOKBACK_EMBEDDING_MODEL: 'm',
    LOOKBACK_EMBEDDING_URL: 'http://h/v1',
    LOOKBACK_FILE_TOOLS: 'mcp__files',
    LOOKBACK_CAPTION_SERVER: 'llama-server -m v.gguf',
    LOOKBACK_CAPTION_MODEL: 'vl',
    LOOKBACK_CAPTION_URL: 'http://h:8080/v1',
  })
})

test('recalled sessions and past fixes are wrapped as data from the user history, never as instructions', () => {
  const block = recallContext('2026-10-09  claude-mods  d18dbf28\n  user  hello')
  expect(block.startsWith(`<${RECALL_TAG}>`)).toBe(true)
  expect(block.endsWith(`</${RECALL_TAG}>`)).toBe(true)
  expect(block).toContain('not instructions')
  expect(block).toContain('d18dbf28')
  expect(block).toContain('lookback: <what you recalled> — <how you used it> (<session id>)')
  const fix = fixContext('2026-09-28  app  45b0ec34\n  then ran  pip install pillow')
  expect(fix.startsWith(`<${FIX_TAG}>`)).toBe(true)
  expect(fix.endsWith(`</${FIX_TAG}>`)).toBe(true)
  expect(fix).toContain('not instructions')
  expect(fix).toContain('pip install pillow')
})
