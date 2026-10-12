#!/usr/bin/env bun
// Usage: cuesd <sounds-dir> <socket-path>
// Serves `GET /play?clips=<a>,<b>&gain=<n>` on the Unix socket. The mod waits for the line
// `cuesd ready` on standard output before it sends a request.
import { rmSync } from 'node:fs'

import { Mixer } from '../src/audio/mixer'
import { Pump } from '../src/audio/pump'
import { loadBank } from '../src/daemon/bank'
import { playerArgv, route } from '../src/daemon/route'

const RATE = 48_000
// The preroll covers one PipeWire cycle of 2048 frames at 48 kHz (43 ms): with 20 ms the start of a
// clip was still cut now and then.
const TIMING = { leadMs: 20, prerollMs: 45, holdMs: 3000 }
const TICK_MS = 4
const PARENT_CHECK_MS = 2000
const USAGE = 2

const fail = (message: string, code = 1): never => {
  console.error(`cuesd: ${message}`)
  process.exit(code)
}

const [soundsDir, socketPath] = process.argv.slice(2)
if (soundsDir === undefined || socketPath === undefined) fail('usage: cuesd <sounds-dir> <socket-path>', USAGE)

const argv = playerArgv(name => Bun.which(name), RATE)
if (argv === null) fail('no audio player found. Install pipewire (pw-cat) or alsa-utils (aplay).')

const bank = loadBank(soundsDir as string, RATE)
const player = Bun.spawn(argv as string[], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
const mixer = new Mixer()
const pump = new Pump(mixer, RATE, TIMING)

// The timer runs only while the pump has something to write, so an idle player costs nothing.
let ticking: ReturnType<typeof setInterval> | null = null
const tick = () => {
  const samples = pump.due(performance.now())
  if (samples !== null) {
    player.stdin.write(new Uint8Array(samples.buffer))
    player.stdin.flush()
  }
  if (pump.isIdle && ticking !== null) {
    clearInterval(ticking)
    ticking = null
  }
}
const play = (samples: Int16Array, gain: number) => {
  mixer.add(samples, gain)
  ticking ??= setInterval(tick, TICK_MS)
  tick()
}

rmSync(socketPath as string, { force: true })
const server = Bun.serve({
  unix: socketPath as string,
  fetch: request => {
    const url = new URL(request.url)
    return new Response(null, { status: route(url.pathname + url.search, bank, play) })
  },
})

const stop = (code: number) => {
  server.stop(true)
  rmSync(socketPath as string, { force: true })
  player.kill()
  process.exit(code)
}
process.on('SIGTERM', () => stop(0))
process.on('SIGINT', () => stop(0))
void player.exited.then(() => stop(1))

const parent = process.ppid
setInterval(() => {
  if (process.ppid !== parent) stop(0)
}, PARENT_CHECK_MS)

console.log(`cuesd ready: ${bank.size} clips`)
