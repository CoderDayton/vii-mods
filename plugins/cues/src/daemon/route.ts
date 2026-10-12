import { parsePlay } from '../request'

const NO_CONTENT = 204
const BAD_REQUEST = 400
const NOT_FOUND = 404

// Answers one request to the player with an HTTP status. `target` is the request's path and query.
// A play request starts the first of its clips that `bank` holds.
export const route = (target: string, bank: ReadonlyMap<string, Int16Array>, play: (samples: Int16Array, gain: number) => void): number => {
  if (target === '/ping') return NO_CONTENT
  const request = parsePlay(target)
  if (request === null) return BAD_REQUEST
  for (const clip of request.clips) {
    const samples = bank.get(clip)
    if (samples === undefined) continue
    play(samples, request.gain)
    return NO_CONTENT
  }
  return NOT_FOUND
}

// How long the audio server may hold sound before it plays, in milliseconds.
const LATENCY_MS = 10
// PipeWire puts the volume it saved for a kind of stream back on each new one, and pw-cat's default
// kind is music: without these the player gets whatever level the music player was last set to.
const STREAM_PROPERTIES = '{ application.name = "cues" node.name = "cues" media.name = "cues" state.restore-props = false }'

// The command that plays raw 16-bit stereo sound from its standard input, or null when the machine
// has none. `which` gives a program's path, as `Bun.which` does.
export const playerArgv = (which: (name: string) => string | null, rate: number): string[] | null => {
  const pipewire = which('pw-cat')
  if (pipewire !== null) {
    const format = ['--raw', '--format', 's16', '--rate', String(rate), '--channels', '2', '--latency', `${LATENCY_MS}ms`]
    const stream = ['--media-role', 'Notification', '--volume', '1', '--properties', STREAM_PROPERTIES]
    return [pipewire, '--playback', ...format, ...stream, '-']
  }
  const alsa = which('aplay')
  if (alsa !== null) return [alsa, '-q', '-t', 'raw', '-f', 'S16_LE', '-r', String(rate), '-c', '2', '-B', String(LATENCY_MS * 2000), '-']
  return null
}
