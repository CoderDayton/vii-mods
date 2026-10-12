// The loudness every clip is brought to, as a 16-bit sample level: 27 dB under full scale. A key
// click is a sharp spike, and this is the loudest that every key press that ships can be made
// while its spike stays under the peak limit.
export const TARGET_LOUDNESS = 1460
// The loudest sample a levelled clip may have: 90% of full scale, which leaves room before the mixer's limit.
export const TARGET_PEAK = 29_490
// The ear sums a sound over about this long, so a short click sounds softer than a held note of the same peak.
const WINDOW_S = 0.1

const peakOf = (samples: Int16Array): number => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)

// How loud a clip sounds: the level (root mean square) of its loudest window. A clip shorter than
// the window counts as that much quieter.
export const loudnessOf = (samples: Int16Array, rate: number): number => {
  const window = Math.max(1, Math.round(WINDOW_S * rate))
  let sum = 0
  let loudest = 0
  for (let i = 0; i < samples.length; i++) {
    const entering = samples[i] ?? 0
    const leaving = i >= window ? (samples[i - window] ?? 0) : 0
    sum += entering * entering - leaving * leaving
    loudest = Math.max(loudest, sum)
  }
  return Math.sqrt(loudest / window)
}

// Brings every clip to the same loudness, so no switch and no chime is louder than the next. A clip
// too sharp to get there is brought up until its peak is at the limit.
export const levelBank = (bank: ReadonlyMap<string, Int16Array>, rate: number): Map<string, Int16Array> => {
  const levelled = new Map<string, Int16Array>()
  for (const [name, samples] of bank) {
    const peak = peakOf(samples)
    if (peak === 0) {
      levelled.set(name, samples)
      continue
    }
    const gain = Math.min(TARGET_LOUDNESS / loudnessOf(samples, rate), TARGET_PEAK / peak)
    levelled.set(name, samples.map(value => Math.round(value * gain)))
  }
  return levelled
}
