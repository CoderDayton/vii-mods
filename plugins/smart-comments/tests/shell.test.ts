import { expect, test } from 'claude-code/testing'

import { isCopied, mentions, parseStatus } from '../src/shell'

test('a file a command copied or moved into place came with its comments', () => {
  expect(isCopied(['mv src/old.ts src/new.ts'], '/work/src/new.ts')).toBe(true)
  expect(isCopied(['mkdir lib && cp -r src/a.ts lib/a.ts'], '/work/lib/a.ts')).toBe(true)
  expect(isCopied(['git mv a.ts b.ts'], '/work/b.ts')).toBe(true)
  expect(isCopied(['cat > src/new.ts <<EOF'], '/work/src/new.ts')).toBe(false)
  expect(isCopied(['cp x.ts y.ts', 'cat > src/new.ts'], '/work/src/new.ts')).toBe(false)
  expect(isCopied(['echo recap > mv.ts'], '/work/mv.ts')).toBe(false)
})

test('git status is read into changed files, new ones marked', () => {
  const out = [' M src/a.ts', '?? src/new file.ts', 'A  src/staged.ts', 'MM src/b.c', ''].join('\0')
  expect(parseStatus(out)).toEqual([
    { path: 'src/a.ts', isNew: false },
    { path: 'src/new file.ts', isNew: true },
    { path: 'src/staged.ts', isNew: true },
    { path: 'src/b.c', isNew: false },
  ])
})

test('a deleted file is left out, and a rename gives its new name only', () => {
  expect(parseStatus([' D gone.ts', 'R  new.ts', 'old.ts', ' M kept.ts', ''].join('\0'))).toEqual([
    { path: 'new.ts', isNew: false },
    { path: 'kept.ts', isNew: false },
  ])
  expect(parseStatus('')).toEqual([])
})

test('a file counts as shell-edited when a command of the turn names it', () => {
  const commands = ["sed -i 's/a/b/' src/users.ts", 'bun run gen.ts']
  expect(mentions(commands, '/work/src/users.ts')).toBe(true)
  expect(mentions(commands, '/work/out/schema.ts')).toBe(false)
  expect(mentions([], '/work/src/users.ts')).toBe(false)
})
