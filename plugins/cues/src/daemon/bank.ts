import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { levelBank } from '../audio/level'
import { resample } from '../audio/resample'
import { SYNTH_SOUNDS, synthChime } from '../audio/synth'
import { decodeWav } from '../audio/wav'

const EXTENSION = '.wav'

// Every clip the player can play, by name: a wav file's path under `dir` without `.wav`, with `/`
// between folders. Clips are one channel at `rate` hertz. A chime with no file of its own is
// synthesized, so a wav at `chimes/<name>.wav` replaces the built-in one. A file that cannot be read
// as wav is left out. Every switch and every chime is brought to one loudness.
export const loadBank = (dir: string, rate: number): Map<string, Int16Array> => {
  const bank = new Map<string, Int16Array>()
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(EXTENSION)) continue
    const path = join(entry.parentPath, entry.name)
    const name = relative(dir, path).slice(0, -EXTENSION.length).split(sep).join('/')
    try {
      const wav = decodeWav(readFileSync(path))
      bank.set(name, resample(wav.samples, wav.rate, rate))
    } catch {
      continue
    }
  }
  for (const chime of SYNTH_SOUNDS) {
    const name = `chimes/${chime}`
    if (!bank.has(name)) bank.set(name, synthChime(chime, rate))
  }
  return levelBank(bank, rate)
}
