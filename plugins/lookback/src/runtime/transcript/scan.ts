import type { Dirent } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type TranscriptFile = { path: string; size: number }

// Every line of a chunk is parsed before any is written, so the chunk size sets the memory a read needs.
const DEFAULT_CHUNK_BYTES = 1024 * 1024
// A line longer than this is not a transcript row; the read gives up on it.
const MAX_LINE_BYTES = 512 * 1024 * 1024

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

const SUBAGENTS = 'subagents'

// The .jsonl files among the entries of a folder.
const transcriptsAmong = async (dir: string, entries: readonly Dirent[]): Promise<TranscriptFile[]> => {
  const files: TranscriptFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const path = join(dir, entry.name)
    files.push({ path, size: (await stat(path)).size })
  }
  return files
}

// The .jsonl files directly inside a folder; none when the folder is not there.
const transcriptsIn = async (dir: string): Promise<TranscriptFile[]> => {
  try {
    return await transcriptsAmong(dir, await readdir(dir, { withFileTypes: true }))
  } catch (error) {
    if (!isMissing(error)) throw error
    return []
  }
}

// The transcripts of every project folder under `root`: a session's is <root>/<project>/<session>.jsonl,
// and those of the sub-agents it started are in <root>/<project>/<session>/subagents/.
export const listTranscripts = async (root: string): Promise<TranscriptFile[]> => {
  const files: TranscriptFile[] = []
  try {
    for (const project of await readdir(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const dir = join(root, project.name)
      const entries = await readdir(dir, { withFileTypes: true })
      files.push(...(await transcriptsAmong(dir, entries)))
      for (const session of entries) {
        if (session.isDirectory()) files.push(...(await transcriptsIn(join(dir, session.name, SUBAGENTS))))
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  return files
}

export const sessionOf = (path: string): string => basename(path, '.jsonl')

export type LineBatch = { lines: string[]; end: number }

// `end` is the byte offset just after the last line of a batch, safe to store as the point to resume from. A
// last line with no newline yet is left for the next read.
export async function* newLines(path: string, from: number, size: number, chunkBytes = DEFAULT_CHUNK_BYTES): AsyncGenerator<LineBatch> {
  const file = await open(path, 'r')
  try {
    let pos = from
    let want = chunkBytes
    while (pos < size) {
      const length = Math.min(want, size - pos)
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(buffer, 0, length, pos)
      const newline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a)

      if (newline === -1) {
        const reachedEnd = pos + length >= size
        if (reachedEnd || want >= MAX_LINE_BYTES) return
        want *= 2
        continue
      }
      want = chunkBytes
      pos += newline + 1
      const lines = buffer
        .subarray(0, newline)
        .toString('utf8')
        .split('\n')
        .map(line => line.replace(/\r$/, ''))
        .filter(line => line !== '')
      yield { lines, end: pos }
    }
  } finally {
    await file.close()
  }
}
