import { dirname, join } from 'node:path'

import type OpenAI from 'openai'

import type { CaptionConfig, Config } from '../config'
import { CaptionRejectedError, CaptionUnavailableError } from './errors'
import { KEEP_MS, leaseServer } from './keeper'

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

const PROMPT =
  'Describe the image in a few plain sentences, then transcribe all visible text exactly as written. Do not guess the name of a game, app, or brand unless it is written in the image.'
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

export const captionSourceFor = (config: Config, keepMs = KEEP_MS): CaptionSource | null => {
  const c: CaptionConfig = config.caption
  if (c.server !== '') {
    const options = { command: c.server, statePath: join(dirname(config.databasePath), 'caption-server.json'), idleMs: keepMs }
    return {
      kind: 'server',
      open: async () => {
        let held = await leaseServer(options)
        let inner = new OpenAICaptioner({ baseURL: held.baseURL, model: c.model || 'local' })
        const captioner: Captioner = {
          async caption(image, media) {
            const beat = setInterval(() => held.touch(), 5000)
            try {
              held.touch()
              const said = await inner.caption(image, media)
              held.touch()
              return said
            } catch (error) {
              const timedOut = (error as { cause?: { name?: string } }).cause?.name === 'APIConnectionTimeoutError'
              if (!(error instanceof CaptionUnavailableError) || timedOut) throw error
              held = await leaseServer(options)
              inner = new OpenAICaptioner({ baseURL: held.baseURL, model: c.model || 'local' })
              const said = await inner.caption(image, media)
              held.touch()
              return said
            } finally {
              clearInterval(beat)
            }
          },
        }
        return { captioner, close: async () => void held.touch() }
      },
    }
  }
  if (c.model === '') return null
  return { kind: 'url', open: async () => ({ captioner: new OpenAICaptioner({ baseURL: c.baseURL, model: c.model, apiKey: c.apiKey }), close: async () => {} }) }
}
