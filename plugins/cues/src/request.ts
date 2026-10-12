// The one request the player takes: `GET /play?clips=<a>,<b>&gain=<n>`. It plays the first clip it
// has. A clip is a sound file's path under the sounds folder, without `.wav`.
export type PlayRequest = { clips: string[]; gain: number }

const HOST = 'http://cues'
const MAX_GAIN = 2
const CLIP = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/

export const playUrl = (clips: readonly string[], gain: number): string => `${HOST}/play?clips=${clips.join(',')}&gain=${gain.toFixed(2)}`

// `target` is a request line's path and query. Null for anything that is not a well-formed play request.
export const parsePlay = (target: string): PlayRequest | null => {
  const [path, query = ''] = target.split('?', 2)
  if (path !== '/play') return null
  const params = new Map(query.split('&').map(pair => pair.split('=', 2) as [string, string | undefined]))
  const clips = (params.get('clips') ?? '').split(',')
  if (!clips.every(clip => CLIP.test(clip))) return null
  const raw = params.get('gain')
  const gain = raw === undefined ? 1 : Number(raw)
  if (raw === '' || Number.isNaN(gain)) return null
  return { clips, gain: Math.min(MAX_GAIN, Math.max(0, gain)) }
}
