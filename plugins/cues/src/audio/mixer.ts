const DEFAULT_MAX_VOICES = 32
const MAX_SAMPLE = 32_767
// Above this level a sum is bent toward the limit, not cut flat: a flat cut is heard as a crackle.
const KNEE = 26_214

const limit = (sum: number): number => {
  const size = Math.abs(sum)
  if (size <= KNEE) return Math.round(sum)
  const room = MAX_SAMPLE - KNEE
  return Math.sign(sum) * Math.round(KNEE + room * Math.tanh((size - KNEE) / room))
}

type Voice = { samples: Int16Array; at: number; gain: number }

// Sums the clips that are playing into one stereo stream.
export class Mixer {
  #voices: Voice[] = []
  readonly #maxVoices: number

  constructor(maxVoices = DEFAULT_MAX_VOICES) {
    this.#maxVoices = maxVoices
  }

  get isIdle(): boolean {
    return this.#voices.length === 0
  }

  // Starts a one-channel clip at the next rendered frame. Past the voice limit the oldest voice stops.
  add(samples: Int16Array, gain: number): void {
    if (samples.length === 0) return
    if (this.#voices.length >= this.#maxVoices) this.#voices.shift()
    this.#voices.push({ samples, at: 0, gain })
  }

  // The next `frames` frames, as left and right samples in turn, held inside 16 bits.
  render(frames: number): Int16Array {
    const out = new Int16Array(frames * 2)
    if (this.isIdle) return out
    const sum = new Float32Array(frames)
    for (const voice of this.#voices) {
      const count = Math.min(frames, voice.samples.length - voice.at)
      for (let i = 0; i < count; i++) sum[i] = (sum[i] ?? 0) + (voice.samples[voice.at + i] ?? 0) * voice.gain
      voice.at += count
    }
    this.#voices = this.#voices.filter(voice => voice.at < voice.samples.length)
    for (let i = 0; i < frames; i++) {
      const sample = limit(sum[i] ?? 0)
      out[i * 2] = sample
      out[i * 2 + 1] = sample
    }
    return out
  }
}
