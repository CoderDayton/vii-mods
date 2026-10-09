import { expect, test } from 'claude-code/testing'

import { quote, scan } from '../src/shell'

const words = (command: string): string[][] => scan(command).segments.map(s => s.words)

test('splits at ; && || | & and newlines', () => {
  expect(words('a && b || c; d | e & f\ng')).toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']])
})

test('keeps separators inside quotes', () => {
  expect(words('echo \'a;b\' "c|d && e"')).toEqual([['echo', 'a;b', 'c|d && e']])
})

test('keeps an escaped quote inside a double-quoted string', () => {
  expect(words('echo "a \\" b; c" d')).toEqual([['echo', 'a " b; c', 'd']])
})

test('keeps a quoted string that runs over several lines', () => {
  expect(words('python -c "import x\nprint(1)"')).toEqual([['python', '-c', 'import x\nprint(1)']])
})

test('does not split at a redirect', () => {
  expect(words('python x.py > out.log 2>&1 &')).toEqual([['python', 'x.py', '>', 'out.log', '2>&1']])
  expect(words('cmd &> log')).toEqual([['cmd', '&>', 'log']])
})

test('splits at $( ) and backticks', () => {
  expect(words('echo $(python train.py)')).toEqual([['echo', '$'], ['python', 'train.py']])
  expect(words('echo `date`')).toEqual([['echo'], ['date']])
})

test('reads a comment only at the start of a word, outside quotes', () => {
  expect(scan('echo hi # gpu 8g').comments).toEqual(['gpu 8g'])
  expect(scan('echo a#b').comments).toEqual([])
  expect(scan('echo "# no" \'# no\'').comments).toEqual([])
  expect(scan('# whole line').segments).toEqual([])
  expect(scan('# whole line').comments).toEqual(['whole line'])
})

test('puts a heredoc body on its own segment text, never splitting it', () => {
  const r = scan("cat <<'EOF'\nit's here; & | stuff\nEOF\necho after")
  expect(r.segments.length).toBe(2)
  expect(r.segments[0]?.text.includes("it's here; & | stuff")).toBe(true)
  expect(r.segments[0]?.words).toEqual(['cat', '<<EOF'])
  expect(r.segments[1]?.words).toEqual(['echo', 'after'])
})

test('reads a <<- heredoc whose end line is tab-indented', () => {
  const r = scan('cat <<-EOF\n\tbody; line\n\tEOF\nls')
  expect(r.segments.map(s => s.words[0])).toEqual(['cat', 'ls'])
})

test('a heredoc with no end line runs to the end of the command', () => {
  const r = scan('cat <<EOF\nnever closed; ls')
  expect(r.segments.length).toBe(1)
})

test('a trailing backslash and an unclosed quote do not throw', () => {
  expect(() => scan('echo a \\')).not.toThrow()
  expect(() => scan('echo "open')).not.toThrow()
  expect(() => scan("echo 'open")).not.toThrow()
})

test('empty and blank commands have no segments', () => {
  expect(scan('').segments).toEqual([])
  expect(scan('  \n\t ').segments).toEqual([])
})

test('quote wraps a string so a shell reads it back unchanged', () => {
  expect(quote('plain')).toBe("'plain'")
  expect(quote("it's")).toBe("'it'\\''s'")
  expect(quote('a b $x `y` "z"')).toBe("'a b $x `y` \"z\"'")
})
