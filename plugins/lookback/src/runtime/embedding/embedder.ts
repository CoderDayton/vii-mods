import OpenAI from 'openai'

export type EmbeddingRole = 'document' | 'query'

export interface Embedder {
  readonly model: string
  embed(texts: readonly string[], role: EmbeddingRole): Promise<number[][]>
  dimension(): Promise<number>
}

// The embedding server did not answer, or answered with something unusable. Callers fall back to keyword search.
export class EmbeddingUnavailableError extends Error {
  override readonly name = 'EmbeddingUnavailableError'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
  }
}

export type Prefixes = { document: string; query: string }

// The nomic models are trained with a task prefix on every text.
export const prefixesFor = (model: string): Prefixes =>
  /^nomic-embed-text/.test(model) ? { document: 'search_document: ', query: 'search_query: ' } : { document: '', query: '' }

export type OpenAIEmbedderOptions = {
  baseURL: string
  model: string
  apiKey?: string
  batchSize?: number
  timeoutMs?: number
  maxRetries?: number
  prefixes?: Prefixes
}

const DEFAULT_BATCH = 64
// The first request after the model was unloaded waits for it to load.
const DEFAULT_TIMEOUT_MS = 120_000

// An embedder for any server that speaks the OpenAI embeddings API, Ollama's /v1 among them.
export class OpenAIEmbedder implements Embedder {
  readonly model: string
  private readonly client: OpenAI
  private readonly batchSize: number
  private readonly prefixes: Prefixes
  private known: number | null = null

  constructor(options: OpenAIEmbedderOptions) {
    this.model = options.model
    this.batchSize = options.batchSize ?? DEFAULT_BATCH
    this.prefixes = options.prefixes ?? prefixesFor(options.model)
    this.client = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey ?? 'ollama',
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? 1,
    })
  }

  async embed(texts: readonly string[], role: EmbeddingRole): Promise<number[][]> {
    const prefix = this.prefixes[role]
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize).map(t => prefix + t)
      out.push(...(await this.request(batch)))
    }
    return out
  }

  async dimension(): Promise<number> {
    this.known ??= (await this.embed(['dimension probe'], 'document'))[0]?.length ?? 0
    return this.known
  }

  private async request(input: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({ model: this.model, input, encoding_format: 'float' })
      if (response.data.length !== input.length) throw new Error(`asked for ${input.length} vectors, got ${response.data.length}`)
      return [...response.data].sort((a, b) => a.index - b.index).map(d => d.embedding)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new EmbeddingUnavailableError(`embedding with ${this.model} failed: ${reason}`, error)
    }
  }
}
