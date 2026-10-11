#!/usr/bin/env bun
import { main } from '../src/cli/main'

const code = await main(process.argv.slice(2), {
  env: process.env,
  stdout: text => void process.stdout.write(text),
  stderr: text => void process.stderr.write(text),
  now: () => Date.now(),
})
process.exit(code)
