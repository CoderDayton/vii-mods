import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cutLoop } from '../core/text/loops'
import { redact } from '../core/text/redact'
import { MAX_ENTRY_CHARS } from '../core/transcript/entries'
import { IMAGE_TYPES } from '../core/transcript/pastes'
import type { Paste } from '../core/transcript/pastes'
import type { KeptPaste } from '../core/types'
import type { CaptionSource } from './captions/captioner'
import { CaptionUnavailableError } from './captions/errors'
import type { Store } from './store/store'

// Writes a pasted image to the folder once, named by the hash of its bytes, readable by its owner alone: the
// transcript's copy goes when Claude Code deletes old sessions, and the source path is often under /tmp.
// A paste with no key is left out, since nothing could tell it apart when it is read again.
export const keepPaste = (dir: string, paste: Paste): KeptPaste | null => {
  if (paste.key === undefined) return null
  const bytes = Buffer.from(paste.data, 'base64')
  const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const file = `${sha}.${IMAGE_TYPES[paste.media]}`
  const path = join(dir, file)
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path, bytes, { mode: 0o600 })
  }
  return { key: paste.key, sha, file, session: paste.session, ...(paste.parent === undefined ? {} : { parent: paste.parent }), project: paste.project, ts: paste.ts }
}

const MEDIA = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([media, ext]) => [ext, media]))

const STOP_AFTER = 2
// Entries made as captions arrive, so a run that is stopped keeps what it made.
const PLACE_EVERY = 16

export type CaptionReport = { images: number; captionError: string | null }

// A caption as stored: a loop cut off, any secret on screen redacted, and no longer than an entry.
export const cleanCaption = (text: string): string => redact(cutLoop(text).trim()).slice(0, MAX_ENTRY_CHARS - 300)

// Captions the images that pastes wait on, then gives each paste its entry. The source is opened only when
// some image has no caption, so a run with none starts no server.
export const captionPending = async (store: Store, source: CaptionSource, report: CaptionReport): Promise<void> => {
  report.images += store.placeCaptions()
  const waiting = store.uncaptioned()
  if (waiting.length === 0) return
  let session
  try {
    session = await source.open()
  } catch (error) {
    if (!(error instanceof CaptionUnavailableError)) throw error
    report.captionError = error.message
    return
  }
  try {
    let failed = 0
    for (const [i, image] of waiting.entries()) {
      const path = join(store.imagesDir, image.file)
      if (!existsSync(path)) {
        store.captionFailed(image.sha)
        continue
      }
      let said: string
      try {
        said = await session.captioner.caption(readFileSync(path), MEDIA[image.file.split('.').pop() ?? ''] ?? 'image/png')
      } catch (error) {
        if (error instanceof CaptionUnavailableError) {
          report.captionError = error.message
          break
        }
        store.captionFailed(image.sha)
        if (++failed < STOP_AFTER) continue
        report.captionError = error instanceof Error ? error.message : String(error)
        break
      }
      store.setCaption(image.sha, cleanCaption(said))
      failed = 0
      if ((i + 1) % PLACE_EVERY === 0) report.images += store.placeCaptions()
    }
  } finally {
    await session.close()
  }
  report.images += store.placeCaptions()
}
