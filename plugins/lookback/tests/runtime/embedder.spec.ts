import { afterEach, beforeEach, expect, test } from 'bun:test'

import { EmbeddingUnavailableError, OpenAIEmbedder, prefixesFor } from '../../src/runtime/embedding/embedder'

type Seen = { model: string; input: string[] }

let server: ReturnType<typeof Bun.serve>
let seen: Seen[]
let respond: (req: Request) => Response | Promise<Response>

const vectorOf = (text: string): number[] => [text.length, text.charCodeAt(0) || 0, 1]

const embedder = (extra: Partial<ConstructorParameters<typeof OpenAIEmbedder>[0]> = {}): OpenAIEmbedder =>
  new OpenAIEmbedder({ baseURL: `http://localhost:${server.port}/v1`, model: 'nomic-embed-text', maxRetries: 0, ...extra })

beforeEach(() => {
  seen = []
  respond = async req => {
    const body = (await req.json()) as Seen
    seen.push(body)
    const data = body.input.map((text, index) => ({ object: 'embedding', index, embedding: vectorOf(text) })).reverse()
    return Response.json({ object: 'list', model: body.model, data, usage: { prompt_tokens: 1, total_tokens: 1 } })
  }
  server = Bun.serve({ port: 0, fetch: req => respond(req) })
})

afterEach(() => {
  server.stop(true)
})

test('vectors come back in the order of the texts, whatever order the server answers in', async () => {
  const out = await embedder({ prefixes: { document: '', query: '' } }).embed(['aa', 'b', 'cccc'], 'document')
  expect(out).toEqual([vectorOf('aa'), vectorOf('b'), vectorOf('cccc')])
})

test('texts are sent in batches of the size asked', async () => {
  const texts = Array.from({ length: 5 }, (_, i) => `text ${i}`)
  await embedder({ batchSize: 2, prefixes: { document: '', query: '' } }).embed(texts, 'document')
  expect(seen.map(s => s.input.length)).toEqual([2, 2, 1])
})

test('nomic models get the task prefix of the role, other models none', async () => {
  await embedder().embed(['hello'], 'document')
  await embedder().embed(['hello'], 'query')
  expect(seen.map(s => s.input[0])).toEqual(['search_document: hello', 'search_query: hello'])

  expect(prefixesFor('mxbai-embed-large')).toEqual({ document: '', query: '' })
  expect(prefixesFor('nomic-embed-text:latest').query).toBe('search_query: ')
})

test('an empty list costs no request', async () => {
  expect(await embedder().embed([], 'document')).toEqual([])
  expect(seen).toHaveLength(0)
})

test('a server error is reported as the embedding being unavailable', async () => {
  respond = () => new Response('boom', { status: 500 })
  await expect(embedder().embed(['x'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError)
})

test('a server that is not running is reported the same way', async () => {
  const dead = new OpenAIEmbedder({ baseURL: 'http://127.0.0.1:1/v1', model: 'm', maxRetries: 0, timeoutMs: 1000 })
  await expect(dead.embed(['x'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError)
})

test('an answer with the wrong number of vectors is an error', async () => {
  respond = () => Response.json({ object: 'list', model: 'm', data: [], usage: { prompt_tokens: 0, total_tokens: 0 } })
  await expect(embedder().embed(['x'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError)
})

test('the length of the vectors is read from a probe', async () => {
  expect(await embedder().dimension()).toBe(3)
})
