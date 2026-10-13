import type { PluginOptions } from 'claude-code'

export type Options = {
  limit: number
  autoRecall: boolean
  autoIndex: boolean
  errorHints: boolean
  sessionDigest: boolean
  fileNotes: boolean
  fileTools: string
  embeddingModel: string
  embeddingUrl: string
}

export const DEFAULTS: Options = {
  limit: 5,
  autoRecall: true,
  autoIndex: true,
  errorHints: true,
  sessionDigest: true,
  fileNotes: true,
  fileTools: '',
  embeddingModel: 'nomic-embed-text',
  embeddingUrl: 'http://localhost:11434/v1',
}

const MAX_LIMIT = 15

const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

export const readOptions = (raw: PluginOptions): Options => ({
  limit: typeof raw.limit === 'number' ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(raw.limit))) : DEFAULTS.limit,
  autoRecall: flag(raw.autoRecall, DEFAULTS.autoRecall),
  autoIndex: flag(raw.autoIndex, DEFAULTS.autoIndex),
  errorHints: flag(raw.errorHints, DEFAULTS.errorHints),
  sessionDigest: flag(raw.sessionDigest, DEFAULTS.sessionDigest),
  fileNotes: flag(raw.fileNotes, DEFAULTS.fileNotes),
  fileTools: text(raw.fileTools, DEFAULTS.fileTools),
  embeddingModel: text(raw.embeddingModel, DEFAULTS.embeddingModel),
  embeddingUrl: text(raw.embeddingUrl, DEFAULTS.embeddingUrl),
})
