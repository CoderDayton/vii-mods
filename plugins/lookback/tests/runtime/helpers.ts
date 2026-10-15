import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Embedder, EmbeddingRole } from '../../src/runtime/embedding/embedder'
import { EmbeddingUnavailableError } from '../../src/runtime/embedding/embedder'

export const DIMENSION = 32

const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9_]+/g) ?? []

const slot = (word: string): number => {
  let h = 2166136261
  for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % DIMENSION
}

// A bag-of-words vector: texts that share words are near each other. `fixed` pins the vector of a text.
export class FakeEmbedder implements Embedder {
  calls: { texts: readonly string[]; role: EmbeddingRole }[] = []
  failing = false

  constructor(
    readonly model = 'fake',
    private readonly fixed: Record<string, number[]> = {},
  ) {}

  async embed(texts: readonly string[], role: EmbeddingRole): Promise<number[][]> {
    this.calls.push({ texts, role })
    if (this.failing) throw new EmbeddingUnavailableError('the fake server is down')
    return texts.map(text => this.fixed[text] ?? this.bag(text))
  }

  async dimension(): Promise<number> {
    return DIMENSION
  }

  private bag(text: string): number[] {
    const v = new Array<number>(DIMENSION).fill(0)
    for (const word of tokens(text)) v[slot(word)] = (v[slot(word)] ?? 0) + 1
    return v
  }
}

export const pad = (head: number[]): number[] => [...head, ...new Array<number>(DIMENSION - head.length).fill(0)]

export type RowOptions = { session: string; cwd?: string; ts?: string; uuid?: string }

export const userRow = (text: string, o: RowOptions): string =>
  JSON.stringify({ type: 'user', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:00.000Z', message: { role: 'user', content: text } })

export const assistantRow = (text: string, o: RowOptions): string =>
  JSON.stringify({ type: 'assistant', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text }] } })

export const commandRow = (command: string, o: RowOptions): string =>
  JSON.stringify({ type: 'assistant', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:06.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } })

export const toolRow = (name: string, input: Record<string, unknown>, o: RowOptions): string =>
  JSON.stringify({ type: 'assistant', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:06.000Z', ...(o.uuid === undefined ? {} : { uuid: o.uuid }), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] } })

export const resultRow = (output: string, o: RowOptions): string =>
  JSON.stringify({ type: 'user', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:07.000Z', ...(o.uuid === undefined ? {} : { uuid: o.uuid }), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: output }] } })

export const summaryRow = (text: string, o: RowOptions): string =>
  JSON.stringify({ type: 'user', isCompactSummary: true, sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:08.000Z', ...(o.uuid === undefined ? {} : { uuid: o.uuid }), message: { role: 'user', content: text } })

export const errorRow = (output: string, o: RowOptions): string =>
  JSON.stringify({ type: 'user', sessionId: o.session, cwd: o.cwd ?? '/work/app', timestamp: o.ts ?? '2026-10-01T10:00:07.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: output }] } })

// A projects folder of transcripts that a test fills and removes.
export class Projects {
  readonly root = mkdtempSync(join(tmpdir(), 'lookback-projects-'))

  write(project: string, session: string, lines: readonly string[]): string {
    mkdirSync(join(this.root, project), { recursive: true })
    const path = join(this.root, project, `${session}.jsonl`)
    writeFileSync(path, lines.map(l => `${l}\n`).join(''))
    return path
  }

  append(path: string, lines: readonly string[]): void {
    appendFileSync(path, lines.map(l => `${l}\n`).join(''))
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
  }
}

export const tempDir = (): { path: string; remove: () => void } => {
  const path = mkdtempSync(join(tmpdir(), 'lookback-'))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
