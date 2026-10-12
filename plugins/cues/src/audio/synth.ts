// The chimes are made from sine notes, so the mod ships no recording of them.
// `bell` and `notes` are the two sounds the reply chime can be.
export const SYNTH_SOUNDS = ['send', 'error', 'bell', 'notes'] as const
export type SynthSound = (typeof SYNTH_SOUNDS)[number]

// One note: a sine that glides from `from` to `to` hertz, starting `at` seconds in, `length` seconds long.
// `decay` is how fast the note dies away: its level falls by e every 1 / decay of its length.
type Note = { from: number; to: number; at: number; length: number; level: number; decay?: number }

const SCORES: Record<SynthSound, readonly Note[]> = {
  send: [{ from: 520, to: 880, at: 0, length: 0.11, level: 0.4 }],
  // A fundamental with two quieter, shorter overtones is what makes a sine ring like a bell.
  bell: [
    { from: 523, to: 523, at: 0, length: 0.45, level: 0.3, decay: 5 },
    { from: 1046, to: 1046, at: 0, length: 0.3, level: 0.09, decay: 6 },
    { from: 1569, to: 1569, at: 0, length: 0.2, level: 0.036, decay: 7 },
  ],
  notes: [
    { from: 392, to: 392, at: 0, length: 0.24, level: 0.32 },
    { from: 523, to: 523, at: 0.1, length: 0.34, level: 0.32 },
  ],
  error: [
    { from: 233, to: 220, at: 0, length: 0.16, level: 0.42 },
    { from: 175, to: 165, at: 0.12, length: 0.24, level: 0.42 },
  ],
}

const FULL_SCALE = 32_767
const ATTACK_S = 0.004
const RELEASE_S = 0.02
const DECAY = 3

// A note's loudness `t` seconds in: a quick rise, a decay, and a fade to rest at its end.
const envelope = (t: number, length: number, decay: number): number =>
  Math.min(1, t / ATTACK_S) * Math.exp((-decay * t) / length) * Math.min(1, (length - t) / RELEASE_S)

// One channel of 16-bit samples at `rate` hertz.
export const synthChime = (name: SynthSound, rate: number): Int16Array => {
  const notes = SCORES[name]
  const seconds = Math.max(...notes.map(n => n.at + n.length))
  const out = new Int16Array(Math.ceil(seconds * rate))
  for (const note of notes) {
    const start = Math.round(note.at * rate)
    const count = Math.floor(note.length * rate)
    let phase = 0
    for (let i = 0; i < count; i++) {
      const t = i / rate
      const hertz = note.from + (note.to - note.from) * (t / note.length)
      phase += (2 * Math.PI * hertz) / rate
      const sample = Math.sin(phase) * envelope(t, note.length, note.decay ?? DECAY) * note.level * FULL_SCALE
      out[start + i] = (out[start + i] ?? 0) + Math.round(sample)
    }
  }
  return out
}
