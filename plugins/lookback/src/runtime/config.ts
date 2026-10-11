import { join } from 'node:path'

export type EmbeddingConfig = {
  baseURL: string
  model: string
  apiKey: string
}

export type Config = {
  projectsRoot: string
  databasePath: string
  embedding: EmbeddingConfig
}

type Env = Readonly<Record<string, string | undefined>>

const DEFAULT_URL = 'http://localhost:11434/v1'
const DEFAULT_MODEL = 'nomic-embed-text'
// Ollama ignores the key, and the client library insists on one.
const DEFAULT_KEY = 'ollama'

const pick = (env: Env, name: string): string | undefined => {
  const value = env[name]
  return value === undefined || value === '' ? undefined : value
}

// Every setting has a default; a LOOKBACK_ variable overrides it. Takes the environment as an argument so
// callers and tests decide what it holds.
export const configFrom = (env: Env): Config => {
  const home = pick(env, 'HOME')
  if (home === undefined) throw new Error('HOME is not set, so the default folders cannot be found')
  const data = pick(env, 'XDG_DATA_HOME') ?? join(home, '.local', 'share')
  return {
    projectsRoot: pick(env, 'LOOKBACK_PROJECTS') ?? join(home, '.claude', 'projects'),
    databasePath: pick(env, 'LOOKBACK_DB') ?? join(data, 'lookback', 'index.sqlite'),
    embedding: {
      baseURL: pick(env, 'LOOKBACK_EMBEDDING_URL') ?? DEFAULT_URL,
      model: pick(env, 'LOOKBACK_EMBEDDING_MODEL') ?? DEFAULT_MODEL,
      apiKey: pick(env, 'LOOKBACK_EMBEDDING_KEY') ?? DEFAULT_KEY,
    },
  }
}
