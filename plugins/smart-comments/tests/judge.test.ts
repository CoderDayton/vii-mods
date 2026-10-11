import { expect, test } from 'claude-code/testing'

import { judgeFile, roomFor, tallyOf, trips } from '../src/judge'

const SAMPLE = `import { readFile } from 'node:fs/promises'

// Cache for user records
const userCache = new Map<string, User>()

// 40 ms p99 on the 2024 box; above 64 entries the scan beats the hash.
const SCAN_LIMIT = 64

/**
 * Loads a user.
 * @param id the user id
 */
export async function loadUser(id: string): Promise<User> {
  // check the cache
  const hit = userCache.get(id)
  if (hit) return hit

  /** Now uses readFile instead of the old sync call */
  const raw = await readFile(pathOf(id), 'utf8')

  // Must parse before the cache write: a bad file would poison
  // every later read of this id.
  const user = parse(raw)
  userCache.set(id, user) // set the user in the cache
  // eslint-disable-next-line no-console
  console.log(id)
  // Tail of the happy path
  return user
}
`

const kinds = (code: string, path = 'a.ts', allowDocs = true): string =>
  judgeFile(path, code, allowDocs)
    .map(j => `${j.line}:${j.kind}`)
    .join(' ')

test('each comment in a file is sorted by what it adds', () => {
  const judged = judgeFile('src/users.ts', SAMPLE, true)
  expect(judged.map(j => `${j.line}:${j.kind}:${j.why}`)).toEqual([
    '3:noise:repeats the code',
    '6:keep:a measured figure',
    '10:doc:a docstring',
    '11:doc:a docstring',
    '14:noise:repeats the code',
    '18:noise:tells the edit story',
    '21:keep:a rule or a reason',
    '22:keep:a rule or a reason',
    '24:noise:repeats the code',
    '25:keep:a tool directive',
    '27:plain:adds little',
  ])
  expect(tallyOf(judged)).toEqual({ keep: 4, plain: 1, noise: 4 })
  expect(judged[8]?.raw).toBe('// set the user in the cache')
})

test('one noise line trips the check, and so do plain lines past the limit', () => {
  const plain = (n: number) => judgeFile('a.ts', Array.from({ length: n }, (_, i) => `// Tail of path ${'abcdefgh'[i]}\ngo()\n`).join('\n'), true)
  expect(trips(plain(3), 3)).toBe(false)
  expect(trips(plain(4), 3)).toBe(true)
  expect(trips(judgeFile('a.ts', '// check the cache\ncache.get(id)', true), 3)).toBe(true)
  expect(trips(judgeFile('a.ts', '// 40 ms p99 on the 2024 box\nconst N = 64', true), 0)).toBe(false)
})

test('a big edit has room for more plain comments: one for each twenty lines of new code', () => {
  expect(roomFor(3, 0)).toBe(3)
  expect(roomFor(3, 79)).toBe(3)
  expect(roomFor(3, 80)).toBe(4)
  expect(roomFor(3, 400)).toBe(20)
  expect(roomFor(0, 400)).toBe(0)
})

test('a comment that gives the reason is kept, unless it repeats the code', () => {
  expect(kinds('// Read up front so that a late write cannot change it\nconst text = read(path)')).toBe('1:keep')
  expect(kinds('// Sorted here to avoid a second pass in the renderer\nitems.sort(byName)')).toBe('1:keep')
  expect(kinds('// Captured early: by the time the judge starts the transcript has moved on\nconst turn = last()')).toBe('1:keep')
  expect(kinds('// Held in case the peer reconnects\nconst socket = open()')).toBe('1:keep')
  expect(kinds('// so that the user is set\nsetUser(user)')).toBe('1:noise')
})

test('a rule word does not save a comment that repeats the code', () => {
  expect(kinds('// ensure user is not null\nif (user !== null) go()')).toBe('1:noise')
  expect(kinds('// retries stay below 5 because the API bans a client at 6\nconst MAX = 5')).toBe('1:keep')
})

test('a comment that states a return contract, an exit code, an argument, a unit or a consequence is kept', () => {
  expect(kinds('// The owner, or null when nobody holds it.\nexport const owner = (k: string) => map.get(k)')).toBe('1:keep')
  expect(kinds('# Exit 4: the file moved on.\nrun', 'a.sh')).toBe('1:keep')
  expect(kinds('# $1 is the ledger file, $2 the line.\nrun', 'a.sh')).toBe('1:keep')
  expect(kinds('// Arguments: jobs dir, gate file, job file.\nrun()')).toBe('1:keep')
  expect(kinds('// Offsets are 1-based.\nconst col = 1')).toBe('1:keep')
  expect(kinds('// Sizes are in bytes.\nconst n = 0')).toBe('1:keep')
  expect(kinds('// The window starts on a row boundary, so the text is exact.\nconst start = first()')).toBe('1:keep')
})

test('a comment with none of those stays plain', () => {
  expect(kinds('// The open sessions of this project.\nconst open = list()')).toBe('1:plain')
  expect(kinds('// Also sorted by name for the listing.\nconst order = lookup()')).toBe('1:plain')
})

test('a history word counts only as history', () => {
  expect(kinds('// fixed-size ring buffer, 512 entries\nconst ring = make()')).toBe('1:keep')
  expect(kinds('// Refactored the parser\nparse()')).toBe('1:noise')
  expect(kinds('// no longer needed by the worker\nstop()')).toBe('1:noise')
  expect(kinds('// New: reads the file once\nload()')).toBe('1:noise')
  expect(kinds('// New rows that the sweep has yet to reach.\nconst PENDING = 20')).toBe('1:plain')
})

test('a comment marker inside a string is not a comment', () => {
  expect(kinds('const url = "http://x.y/z" // see docs')).toBe('1:plain')
  expect(kinds('const url = "http://x.y/z"')).toBe('')
  expect(kinds('x = "a # b"\ncount += 1  # increment the count', 'a.py')).toBe('2:noise')
})

test('block comments are read line by line, and a kept sentence carries on', () => {
  const code = '/* one-line block */\nconst a = 1\n/*\n * Holds the lock until the swap ends,\n * and across no await.\n */\nlock()'
  expect(kinds(code)).toBe('1:plain 4:keep 5:keep')
})

test('files with no comment syntax are skipped', () => {
  expect(kinds('{"a": 1}', 'a.json')).toBe('')
  expect(kinds('# Title\n// text', 'README.md')).toBe('')
})

test('python, toml, c and c++ comments are read', () => {
  expect(kinds('def f():\n    """Loads a user."""\n    # loop over users\n    for user in users:\n        pass', 'a.py')).toBe('3:noise')
  const toml = '# Retry settings\n[retry]\nmax_retries = 3 # max retries\n# The API bans a client at 6 tries, so stay under it.\nlimit = 5\nurl = "http://a/#x"\n'
  expect(kinds(toml, 'a.toml')).toBe('1:plain 3:noise 4:keep')
  const c = '#include <stdio.h>\n#define MAX 3\nstatic int load_user(int id) {\n    /* increment the count */\n    count++;\n    // return the user\n    return user;\n}\n'
  expect(kinds(c, 'a.c')).toBe('4:noise 6:noise')
  expect(kinds('// loop over users\nfor (auto& user : users) {}\n', 'a.cxx')).toBe('1:noise')
})

test('a docstring right on a declaration is skipped', () => {
  expect(kinds('/** Loads a user. */\nexport function loadUser() {}')).toBe('1:doc')
  expect(kinds('/** Scan limit. */\nconst SCAN = 64')).toBe('1:doc')
  expect(kinds('class A {\n  /**\n   * Loads a user.\n   */\n  loadUser(id: string): User {\n  }\n}')).toBe('3:doc')
})

test('a docstring that is not on a declaration is judged like any comment', () => {
  expect(kinds('/** Loads a user. */\n\nexport function loadUser() {}')).toBe('1:noise')
  expect(kinds('function f() {\n  /** load the user */\n  loadUser(id)\n}')).toBe('2:noise')
  expect(kinds('function f() {\n  /** the user */\n  const user = load()\n}')).toBe('2:noise')
})

test('a block over a control statement is not a docstring', () => {
  expect(kinds('function f() {\n  /** load the user */\n  if (loadUser(id)) {\n  }\n}')).toBe('2:noise')
  expect(kinds('function f() {\n  /** loop over users */\n  for (const user of users) {\n  }\n}')).toBe('2:noise')
  expect(kinds('class A {\n  /** Loads a user. */\n  loadUser(id) {\n  }\n}')).toBe('2:doc')
})

test('a docstring in a file with CRLF line ends is still one', () => {
  expect(kinds('/** Scan limit. */\r\nint kScan = 64;\r\n', 'a.c')).toBe('1:doc')
})

test('a phrase that only looks like history is not history', () => {
  expect(kinds('// Names must be no longer than 64 chars\nconst MAX_NAME = 64')).toBe('1:keep')
  expect(kinds('// Scratch table used to dedupe peers across shards\nconst seen = new Map()')).toBe('1:plain')
  expect(kinds('// This used to return null\nreturn load()')).toBe('1:noise')
  expect(kinds('// The parser used to be recursive\nparse()')).toBe('1:noise')
})

test('directives of other tools are kept', () => {
  expect(kinds('/// <reference types="node" />\nimport fs from "node:fs"')).toBe('1:keep')
  expect(kinds('# frozen_string_literal: true\nclass A\nend', 'a.rb')).toBe('1:keep')
  expect(kinds('# fmt: off\nmatrix = [1, 0]', 'a.py')).toBe('1:keep')
  expect(kinds('// @vitest-environment jsdom\nimport { mount } from "./mount"')).toBe('1:keep')
})

test('with docstrings off they are judged like any comment', () => {
  expect(kinds('/** Loads a user. */\nexport function loadUser() {}', 'a.ts', false)).toBe('1:noise')
})

test('rust, go, c and c++ docstrings are skipped', () => {
  const rust = '/// Loads a user.\n#[inline]\npub fn load_user() {}\n//! crate docs\nfn x() {\n    /// load user\n    let u = load_user();\n}'
  expect(kinds(rust, 'a.rs')).toBe('1:doc 4:doc 6:noise')
  const go = '// LoadUser loads a user\n// from disk.\nfunc LoadUser() {}\n// load the user\nfunc Other() {}'
  expect(kinds(go, 'a.go')).toBe('1:doc 2:doc 4:plain')
  const c = '/**\n * Loads a user.\n */\nstatic int load_user(int id) {\n}\n/** Scan limit. */\nstatic const int kScan = 64;\n/** max users */\n#define MAX_USERS 8\n'
  expect(kinds(c, 'a.c')).toBe('2:doc 6:doc 8:doc')
  const cpp =
    '/// Loads a user.\ntemplate <class T>\nstd::vector<T> Store::load(int id) const {\n    /** call the loader */\n    return loader(id);\n    /// fake\n    x = y(z);\n}\n/*! A cache. */\nclass Cache {\n  //! Drops all entries.\n  void clear();\n};\n'
  expect(kinds(cpp, 'a.hpp')).toBe('1:doc 4:noise 6:plain 9:doc 11:doc')
})
