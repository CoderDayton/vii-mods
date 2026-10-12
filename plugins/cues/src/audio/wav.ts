// 16-bit PCM wav, the one format the sound files use.
export type Wav = { rate: number; channels: number; samples: Int16Array }

const HEADER_BYTES = 44
const PCM = 1

const tag = (view: DataView, at: number): string => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

// Reads a wav file. `samples` is one channel: a file with more is averaged down to it. `channels` is
// the file's own count. Throws on anything that is not 16-bit PCM.
export const decodeWav = (bytes: Uint8Array): Wav => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < HEADER_BYTES || tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') throw new Error('not a wav file')
  let format: { rate: number; channels: number } | null = null
  // Chunks follow the 12-byte RIFF header: a 4-byte name, a 4-byte size, the body, padded to an even length.
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const name = tag(view, at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (name === 'fmt ') {
      if (view.getUint16(body, true) !== PCM || view.getUint16(body + 14, true) !== 16) throw new Error('not 16-bit PCM')
      format = { channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true) }
    } else if (name === 'data') {
      if (format === null || format.channels < 1) throw new Error('wav data before its format')
      const frames = Math.floor(Math.min(size, bytes.byteLength - body) / 2 / format.channels)
      const samples = new Int16Array(frames)
      for (let f = 0; f < frames; f++) {
        let sum = 0
        for (let c = 0; c < format.channels; c++) sum += view.getInt16(body + (f * format.channels + c) * 2, true)
        samples[f] = Math.round(sum / format.channels)
      }
      return { ...format, samples }
    }
    at = body + size + (size % 2)
  }
  throw new Error('wav file has no data')
}

// Writes interleaved 16-bit samples as a wav file.
export const encodeWav = (samples: Int16Array, rate: number, channels = 1): Uint8Array => {
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)
  const put = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, PCM, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataBytes, true)
  samples.forEach((sample, i) => view.setInt16(HEADER_BYTES + i * 2, sample, true))
  return bytes
}
