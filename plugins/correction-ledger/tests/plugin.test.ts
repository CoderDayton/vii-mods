import { expect, mock, test } from 'claude-code/testing'

import { ledgerPathOf } from '../src/disk'
import { addRule, emptyLedger } from '../src/rules'
import type { Ledger } from '../src/rules'

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const COMPOSER = { kind: 'composer' as const }
const DIR = '/cfg/plugins/correction-ledger'

const SAID = 'i said the second cat has no proximity prompt, just loop around'
const RULE = '2nd cat: no ProximityPrompt. It loops its path.'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answer = (text: string) => ({ value: { isAnswered: true as const, text, usage } })
const gaveUp = () => ({ value: { isAnswered: false as const, reason: 'aborted' } }) as never
const newRule = (rule = RULE) => answer(JSON.stringify({ verdict: 'new', rule }))

type Reply = ReturnType<typeof answer> | Promise<never> | ReturnType<typeof gaveUp>

const world = (on: Parameters<typeof mock.clock>[0], reply: (prompt: string) => Reply = () => newRule(), cwd = '/work') => {
  const w = {
    clock: mock.clock(on),
    files: new Map<string, string>(),
    toasts: [] as string[],
    requests: [] as { model: string; system: string; prompt: string; timeoutMs: number }[],
    commands: [] as string[],
    swaps: 0,
    hasRepo: true,
    beforeSwap: () => undefined as void,
    last: 'I added a ProximityPrompt to the second cat.',
  }
  const ok = (stdout = '', exitCode = 0) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: `${cwd}/src/deep` }))
  on('session.root', () => ({ value: `${cwd}/src` }))
  on('session.repo', () => ({ value: w.hasRepo ? { root: cwd, remote: null, internal: false, name: null } : null }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'add the second cat', toolUses: [] },
      { role: 'assistant', text: w.last, toolUses: [] },
    ],
  }) as never)
  on('process.run', (_$, e) => {
    const tag = e.argv[3]
    const path = e.argv[4] ?? ''
    if (tag === 'correction-ledger-dir') return ok(DIR)
    if (tag === 'correction-ledger-swap') {
      w.beforeSwap()
      w.swaps += 1
      if ((w.files.get(path) ?? '') !== (e.init?.env?.['OLD'] ?? '')) return ok('', 4)
      w.files.set(path, e.init?.stdin ?? '')
      return ok()
    }
    if (tag === 'correction-ledger-pause') {
      if ((e.argv[2] ?? '').includes(': >')) w.files.set(`${path}/paused`, '')
      else w.files.delete(`${path}/paused`)
      return ok()
    }
    return ok('', 1)
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('model.complete', (_$, e) => {
    const prompt = typeof e.prompt === 'string' ? e.prompt : e.prompt.map(b => b.text).join('')
    const system = typeof e.system === 'string' ? e.system : (e.system ?? []).map(b => b.text).join('')
    w.requests.push({ model: e.model ?? '', system, prompt, timeoutMs: e.timeoutMs ?? 0 })
    return reply(prompt) as never
  })
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [] }))
  return w
}

const submit = ($: any, text: string, origin: object = COMPOSER) => $.prompt.submit({ text, wait: false, origin })
const settle = async (w: ReturnType<typeof world>) => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await w.clock.advance(1)
}

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
const slash = (args: string) => ({ command: 'rules', args }) as never
const draft = (text: string) => ({ text, quote: '', now: 1 })
const put = (w: ReturnType<typeof world>, ledger: Ledger, cwd = '/work') => w.files.set(ledgerPathOf(DIR, cwd), JSON.stringify(ledger))
const saved = (w: ReturnType<typeof world>, cwd = '/work') => {
  const text = w.files.get(ledgerPathOf(DIR, cwd))
  return text === undefined ? undefined : (JSON.parse(text) as Ledger)
}
const hasSection = async ($: any) => (await $.prompt.compose(COMPOSE)).sections.some((s: { id: string }) => s.id === 'correction-ledger:rules')

test('the command is registered', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(w.commands).toEqual(['rules'])
})

test('a correction is judged with the saved rules and the last answer, and saved as a rule', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  const r = await submit($, SAID)
  await settle(w)
  expect(r.text).toBe(SAID)
  expect(w.requests.length).toBe(1)
  expect(w.requests[0]?.model).toBe('haiku')
  expect(w.requests[0]?.prompt).toContain('I added a ProximityPrompt to the second cat.')
  expect(w.requests[0]?.prompt).toContain(SAID)
  expect(saved(w)?.rules).toMatchObject([{ id: 1, text: RULE, quote: SAID, strikes: 0 }])
  expect(w.toasts).toEqual([`correction-ledger: saved rule #1: ${RULE} (/rules rm 1 to undo)`])
})

test('the prompt goes through at once, even when the model never answers', async ($, on) => {
  const w = world(on, () => new Promise<never>(() => undefined))
  await $.session.start(LIVE)
  const r = await submit($, SAID)
  expect(r.text).toBe(SAID)
  await settle(w)
  expect(w.requests.length).toBe(1)
  expect(w.toasts).toEqual([])
})

test('a prompt that is not a correction never reaches the model', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($, 'add a login page')
  await submit($, '/rules')
  await settle(w)
  expect(w.requests.length).toBe(0)
})

test('only the user’s own prompts are judged', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($, SAID, { kind: 'scheduled-trigger' })
  await submit($, SAID, { kind: 'task-notification' })
  await settle(w)
  expect(w.requests.length).toBe(0)
})

test('a model that gives up, or a reply that is not a verdict, saves nothing and says nothing', async ($, on) => {
  let reply: () => Reply = gaveUp
  const w = world(on, () => reply())
  await $.session.start(LIVE)
  await submit($, SAID)
  await settle(w)
  reply = () => answer('I think that is a correction')
  await submit($, SAID)
  await settle(w)
  expect(saved(w)).toBeUndefined()
  expect(w.toasts).toEqual([])
})

test('saying a saved rule again is a strike, and the rule comes back louder', async ($, on) => {
  let reply: () => Reply = () => newRule()
  const w = world(on, () => reply())
  await $.session.start(LIVE)
  await submit($, SAID)
  await settle(w)
  reply = () => answer('{"verdict":"repeat","id":1}')
  await submit($, 'no, i said the cat has no proximity prompt')
  await settle(w)
  expect(saved(w)?.rules).toMatchObject([{ id: 1, strikes: 1 }])
  expect(w.toasts[1]).toBe(`correction-ledger: rule #1 broken again (1×): ${RULE}`)
  expect(w.requests[1]?.prompt).toContain(`#1 ${RULE}`)
  const composed = await $.prompt.compose(COMPOSE)
  const section = composed.sections.find((s: { id: string }) => s.id === 'correction-ledger:rules')
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain(`- [broken 1×] ${RULE}`)
  expect(section?.text).toContain('Check your work against each one before you answer.')
})

test('no rules, no section', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  expect(await hasSection($)).toBe(false)
})

test('outside a git repository the folder the session started in is the project', async ($, on) => {
  const w = world(on)
  w.hasRepo = false
  await $.session.start(LIVE)
  await submit($, SAID)
  await settle(w)
  expect(saved(w, '/work/src')?.rules.length).toBe(1)
  expect(saved(w, '/work')).toBeUndefined()
})

test('a session started in a subfolder uses the rules of the repository root', async ($, on) => {
  const w = world(on)
  put(w, addRule(emptyLedger(), draft(RULE), 12), '/work')
  await $.session.start({ ...LIVE, cwd: '/work/src/deep' })
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections[0]?.text).toContain(`- ${RULE}`)
  await submit($, SAID)
  await settle(w)
  expect(saved(w, '/work')?.rules).toMatchObject([{ id: 1, text: RULE, strikes: 1 }])
  expect(saved(w, '/work/src/deep')).toBeUndefined()
})

test('rules belong to the project they were made in', async ($, on) => {
  const w = world(on, () => newRule(), '/other')
  put(w, addRule(emptyLedger(), draft(RULE), 12), '/work')
  await $.session.start({ ...LIVE, cwd: '/other' })
  expect(await hasSection($)).toBe(false)
  await submit($, SAID)
  await settle(w)
  expect(saved(w, '/other')?.rules.length).toBe(1)
  expect(saved(w, '/work')?.rules.length).toBe(1)
})

test('/rules lists, adds and removes rules, and survives a corrupt file', async ($, on) => {
  const w = world(on)
  w.files.set(ledgerPathOf(DIR, '/work'), 'garbage')
  await $.session.start(LIVE)
  expect(((await $.command.run(slash(''))) as { text: string }).text).toContain('No standing corrections')
  expect(((await $.command.run(slash('add never use var'))) as { text: string }).text).toBe('Saved #1: never use var')
  expect(((await $.command.run(slash(''))) as { text: string }).text).toContain('#1  never use var')
  expect(((await $.command.run(slash('rm 1'))) as { text: string }).text).toBe('Removed #1: never use var')
  expect(saved(w)?.rules).toEqual([])
})

test('/rules off stops judging and sending, and /rules on brings it back', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await $.command.run(slash('add never use var'))
  await $.command.run(slash('off'))
  expect(w.files.has(`${DIR}/paused`)).toBe(true)
  await submit($, SAID)
  await settle(w)
  expect(w.requests.length).toBe(0)
  expect(await hasSection($)).toBe(false)
  await $.command.run(slash('on'))
  expect(w.files.has(`${DIR}/paused`)).toBe(false)
  expect(await hasSection($)).toBe(true)
})

test('a rule another session saved is sent on the next turn, with no restart', async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  expect(await hasSection($)).toBe(false)
  put(w, addRule(emptyLedger(), draft('rule from the other session'), 12))
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections[0]?.text).toContain('- rule from the other session')
  expect(((await $.command.run(slash(''))) as { text: string }).text).toContain('rule from the other session')
})

test('a save that races another session keeps both rules', async ($, on) => {
  const w = world(on)
  let rival = true
  w.beforeSwap = () => {
    if (!rival) return
    rival = false
    put(w, addRule(emptyLedger(), draft('rule from the other session'), 12))
  }
  await $.session.start(LIVE)
  await submit($, SAID)
  await settle(w)
  expect(saved(w)?.rules.map(r => r.text)).toEqual(['rule from the other session', RULE])
  expect(saved(w)?.rules.map(r => r.id)).toEqual([1, 2])
  expect(w.toasts).toEqual([`correction-ledger: saved rule #2: ${RULE} (/rules rm 2 to undo)`])
})

test('a write that fails says so and the prompt is untouched', async ($, on) => {
  const w = world(on)
  w.beforeSwap = () => {
    throw new Error('disk full')
  }
  await $.session.start(LIVE)
  const r = await submit($, SAID)
  await settle(w)
  expect(r.text).toBe(SAID)
  expect(saved(w)).toBeUndefined()
  expect(w.toasts).toEqual(['correction-ledger: a correction could not be saved'])
})

test('options pick the model, the timeout and the cap', { options: { model: 'sonnet', timeoutSeconds: 9, maxRules: 3 } }, async ($, on) => {
  const w = world(on)
  await $.session.start(LIVE)
  await submit($, SAID)
  await settle(w)
  expect(w.requests[0]).toMatchObject({ model: 'sonnet', timeoutMs: 9000 })
})
