// Changes a clip's sample rate by straight-line interpolation between neighbouring samples.
export const resample = (samples: Int16Array, from: number, to: number): Int16Array => {
  if (from === to) return samples
  const out = new Int16Array(Math.round((samples.length * to) / from))
  const last = samples.length - 1
  for (let i = 0; i < out.length; i++) {
    const at = Math.min(last, (i * from) / to)
    const left = Math.floor(at)
    const a = samples[left] ?? 0
    const b = samples[Math.min(last, left + 1)] ?? a
    out[i] = Math.round(a + (b - a) * (at - left))
  }
  return out
}
