import type OpenAI from 'openai'

import type { CaptionConfig, Config } from '../config'
import { CaptionRejectedError, CaptionUnavailableError } from './errors'
import { startServer } from './server'

export interface Captioner {
  caption(image: Uint8Array, media: string): Promise<string>
}

export type CaptionSession = { captioner: Captioner; close(): Promise<void> }

// Where captions come from. `open` is called only when there are images to caption.
export interface CaptionSource {
  readonly kind?: 'server' | 'url'
  open(): Promise<CaptionSession>
}

export { CaptionRejectedError, CaptionUnavailableError }

// Plain transcription: a prompt that asks for sections makes small models fill them with guesses.
const PROMPT = 'Transcribe all visible text in this image, exactly as written. Then say in one line what app or page this is.'
const MAX_TOKENS = 400
// The first request waits for the model to load.
const TIMEOUT_MS = 120_000
// Ollama unloads the model this long after the last caption, so it holds no memory between runs. The
// sampler fields are llama.cpp's, for transcribing text without loops; servers that lack them ignore them.
const REQUEST_EXTRAS = { keep_alive: '15s', min_p: 0.15, repeat_penalty: 1.05, dry_multiplier: 0.8 }

export type OpenAICaptionerOptions = { baseURL: string; model: string; apiKey?: string; timeoutMs?: number }

// A captioner for any server that speaks the OpenAI chat API with images: llama-server, Ollama, LM Studio.
export class OpenAICaptioner implements Captioner {
  private client: Promise<OpenAI> | null = null

  constructor(private readonly options: OpenAICaptionerOptions) {}

  private connect(): Promise<OpenAI> {
    const { baseURL, apiKey, timeoutMs } = this.options
    this.client ??= import('openai').then(({ default: Client }) => new Client({ baseURL, apiKey: apiKey ?? 'local', timeout: timeoutMs ?? TIMEOUT_MS, maxRetries: 0 }))
    return this.client
  }

  async caption(image: Uint8Array, media: string): Promise<string> {
    const url = `data:${media};base64,${Buffer.from(image).toString('base64')}`
    try {
      const response = await (await this.connect()).chat.completions.create({
        model: this.options.model,
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: PROMPT }] }],
        ...REQUEST_EXTRAS,
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
      return response.choices[0]?.message.content ?? ''
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const answered = typeof (error as { status?: unknown } | null)?.status === 'number'
      throw new (answered ? CaptionRejectedError : CaptionUnavailableError)(`captioning with ${this.options.model} failed: ${reason}`, error)
    }
  }
}

// The caption source the settings name, or null when captions are off. A server command is started for the
// run and stopped after it; a model alone is asked for at the caption address.
export const captionSourceFor = (config: Config): CaptionSource | null => {
  const c: CaptionConfig = config.caption
  if (c.server !== '') {
    return {
      kind: 'server',
      open: async () => {
        const server = await startServer(c.server)
        return { captioner: new OpenAICaptioner({ baseURL: server.baseURL, model: c.model || 'local' }), close: () => server.stop() }
      },
    }
  }
  if (c.model === '') return null
  return { kind: 'url', open: async () => ({ captioner: new OpenAICaptioner({ baseURL: c.baseURL, model: c.model, apiKey: c.apiKey }), close: async () => {} }) }
}
