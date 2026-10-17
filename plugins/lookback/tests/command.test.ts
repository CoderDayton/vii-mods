import { expect, test } from 'claude-code/testing'

import { commandWords } from '../src/core/text/command'

test('a server command is split into its words, with quotes holding a path that has spaces', () => {
  expect(commandWords('/opt/llama/llama-server -m /m/model.gguf --mmproj "/my models/mmproj.gguf" -c 4096')).toEqual([
    '/opt/llama/llama-server',
    '-m',
    '/m/model.gguf',
    '--mmproj',
    '/my models/mmproj.gguf',
    '-c',
    '4096',
  ])
  expect(commandWords("  srv  --a 'b c'\n  --d\\\n e ")).toEqual(['srv', '--a', 'b c', '--d', 'e'])
  expect(commandWords('')).toEqual([])
})
