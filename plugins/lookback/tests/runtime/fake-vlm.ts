// A stand-in for llama-server: takes --host and --port, is ready after a short wait, and answers a chat
// request with what the request held, as JSON.
const at = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

const startedAt = Date.now()

Bun.serve({
  hostname: at('--host') ?? '127.0.0.1',
  port: Number(at('--port') ?? 0),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/health') return Date.now() - startedAt < 300 ? new Response('loading', { status: 503 }) : new Response('ok')
    if (url.pathname === '/v1/chat/completions') {
      const body = (await request.json()) as { model: string; temperature: number; max_tokens: number; keep_alive?: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] }
      const image = body.messages[0]?.content.find(c => c.type === 'image_url')?.image_url?.url ?? ''
      const seen = { model: body.model, temperature: body.temperature, max_tokens: body.max_tokens, keep_alive: body.keep_alive, image: image.slice(0, 22), args: process.argv.slice(2).filter(a => a.startsWith('--extra')) }
      return Response.json({ id: 'c', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(seen) } }] })
    }
    return new Response('not found', { status: 404 })
  },
})
