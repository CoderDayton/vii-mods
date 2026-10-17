import { asString, isHeadless, ownerOf } from './entries'
import type { Row } from './entries'

// An image a person pasted into a prompt, as the transcript holds it: base64 bytes of a known type.
export type Paste = {
  session: string
  parent?: string
  project: string
  ts: number
  // Names the paste across transcripts, as an entry's key does. Absent for a row with no id.
  key?: string
  media: string
  data: string
}

// The file extension of each image type a paste can have.
export const IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

type Block = { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } }

// The images pasted into one prompt. An image a tool returned sits inside its result block and is not one.
export const pastesOfRow = (row: Row | null): Paste[] => {
  if (row === null || row.type !== 'user' || row.isMeta === true || row.isCompactSummary === true || isHeadless(row)) return []
  const content = row.message?.content
  const owner = ownerOf(row)
  if (owner === null || !Array.isArray(content)) return []
  const ts = Date.parse(asString(row.timestamp))
  const uuid = asString(row.uuid)
  const out: Paste[] = []
  for (const [i, block] of (content as Block[]).entries()) {
    const media = asString(block.source?.media_type)
    const data = asString(block.source?.data)
    if (block.type !== 'image' || block.source?.type !== 'base64' || IMAGE_TYPES[media] === undefined || data === '') continue
    out.push({ ...(uuid === '' ? {} : { key: `${uuid}:i${i}` }), ...owner, project: asString(row.cwd), ts: Number.isNaN(ts) ? 0 : ts, media, data })
  }
  return out
}
