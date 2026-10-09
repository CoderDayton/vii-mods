import { expect, mock, test as baseTest } from 'claude-code/testing'

// The menu tests below run with auto accept off; a test that sets autoAccept keeps its own value.
const test = ((name: string, a: unknown, b?: unknown) => {
  const [spec, fn] = typeof a === 'function' ? [{}, a] : [a as { options?: Record<string, unknown> }, b]
  return baseTest(name, { ...spec, options: { autoAccept: false, ...spec.options } } as never, fn as never)
}) as unknown as typeof baseTest

const LIVE = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }

const HISTORY_FILE = '/home/test/.claude/history.jsonl'
const HISTORY_TAIL = [
  JSON.stringify({ display: 'an old prompt', pastedContents: {}, timestamp: 1, project: '/work', sessionId: 'old' }),
  JSON.stringify({ display: 'a newer prompt', pastedContents: {}, timestamp: 2, project: '/work', sessionId: 'old' }),
].join('\n')

const DRAFT = 'make a calculator in python'
const BETTER = 'Make a calculator in Python.'

const usage = {
  input_tokens: 10,
  output_tokens: 10,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
const answer = (text: string) => ({ value: { isAnswered: true as const, text, usage } })
const wrap = (s: string) => answer(`<enhanced>${s}</enhanced>`)

type Reply = ReturnType<typeof answer>

const world = (
  on: Parameters<typeof mock.clock>[0],
  draft = DRAFT,
  reply: (prompt: string) => Reply = () => wrap(BETTER),
) => {
  mock.clock(on)
  const seen = {
    calls: 0,
    toasts: [] as string[],
    filled: [] as string[],
    box: draft,
    belowPressed: 0,
    model: '',
    effort: '',
    timeoutMs: 0,
    keys: '{"bindings":[]}',
    isBoxBusy: false,
    isPanePlaced: false,
    opened: [] as Array<{ id: string; title?: string; rows?: number }>,
    closed: [] as string[],
    historyTail: HISTORY_TAIL,
    tailExit: 0,
    appendExit: 0,
    tails: [] as string[][],
    appended: [] as string[][],
  }
  const ran = (stdout: string, exitCode = 0) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/src' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'tail') {
      seen.tails.push([...e.argv])
      return ran(seen.historyTail, seen.tailExit)
    }
    if (e.argv[3] === 'rescribe-history') {
      seen.appended.push([...e.argv])
      return ran('', seen.appendExit)
    }
    return ran('', 1)
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: seen.keys }))
  on('prompt.read', () => ({ value: { text: seen.box, cursor: seen.box.length } }))
  on('model.complete', (_$, e) => {
    seen.calls += 1
    seen.model = e.model ?? ''
    seen.effort = e.effort ?? ''
    seen.timeoutMs = e.timeoutMs ?? 0
    return reply(e.prompt)
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('prompt.fill', (_$, e) => {
    if (seen.isBoxBusy) return { isFilled: false } as never
    seen.filled.push(e.text)
    seen.box = e.text
    return { isFilled: true }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push({ id: e.id, title: e.title, rows: (e as { rows?: number }).rows })
    return { value: seen.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } } as never
  })
  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.render', (engine, e) => {
    const { Box, Text, Button } = engine.ui.resolve(e)
    return (
      <Box>
        <Text>baseline</Text>
        <Button
          key="below"
          label="below"
          onPress={() => {
            seen.belowPressed += 1
          }}
        />
      </Box>
    )
  })
  return seen
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

type Splice = { text: string; cursor: number; start: number; end: number; inputText: string }

const splice = ($: Engine, s: Splice): Promise<{ text: string; cursor: number }> =>
  (
    $.prompt as unknown as {
      edit: (e: Splice & { origin: { kind: 'composer' } }) => Promise<{ text: string; cursor: number }>
    }
  ).edit({ origin: { kind: 'composer' }, ...s })

const band = ($: Engine, props: Record<string, unknown> = { hasSurvey: false }) =>
  $.ui.mount({ plugin: 'rescribe', surface: 'terminal', component: 'AbovePrompt', props: props as never })

const PANE_ID = 'rescribe-diff'

const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'rescribe', surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE_ID })

const isMenuOpen = async (ui: Awaited<ReturnType<typeof band>>) =>
  (await ui.find({ type: 'Button', text: /Apply/ })) !== undefined

test('with nothing to review the band holds one button for the shortcut', async ($, on) => {
  world(on)
  const ui = await band($)
  expect(await ui.find({ type: 'Button', text: /Enhance Prompt/ })).toBeDefined()
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('the shortcut button names an engine action nothing else handles', async ($, on) => {
  world(on)
  const ui = await band($)
  const button = (await ui.find({ type: 'Button', text: /Enhance Prompt/ })) as unknown as { props?: { action?: string } }
  expect(button.props?.action).toBe('app:toggleDiffNoiseFilter')
  await ui.unmount()
})

test('pressing it enhances the draft, leaves it in the box and opens the menu', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.calls).toBe(1)
  expect(seen.filled).toEqual([])
  expect(await isMenuOpen(ui)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Enhance Prompt/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Dismiss/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /✎ Enhance Prompt/ })).toBeUndefined()
  await ui.unmount()
})

test('the model call uses haiku on high effort and twenty seconds by default', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.model).toBe('haiku')
  expect(seen.effort).toBe('high')
  expect(seen.timeoutMs).toBe(20000)
  await ui.unmount()
})

test(
  'the model, effort and timeout come from the plugin options',
  { options: { model: 'sonnet', effort: 'low', timeoutSeconds: 45 } },
  async ($, on) => {
    const seen = world(on)
    await $.session.start(LIVE)
    const ui = await band($)

    await ui.press({ key: 'enhance' })

    expect(seen.model).toBe('sonnet')
    expect(seen.effort).toBe('low')
    expect(seen.timeoutMs).toBe(45000)
    await ui.unmount()
  },
)

baseTest('auto accept is on by default: the enhanced text goes straight into the box', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.filled).toEqual([BETTER])
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('with auto accept off, the draft stays in the box until Apply', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.filled).toEqual([])
  expect(seen.box).toBe(DRAFT)
  await ui.unmount()
})

test('with auto accept on, the enhanced text goes straight into the box and no menu opens', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.filled).toEqual([BETTER])
  expect(seen.box).toBe(BETTER)
  expect(await isMenuOpen(ui)).toBe(false)
  expect(seen.toasts.join(' ')).toMatch(/applied/i)
  await ui.unmount()
})

test('with auto accept on, a reply that changes nothing fills nothing', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on, DRAFT, () => wrap(DRAFT))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.filled).toEqual([])
  expect(seen.toasts.join(' ')).toMatch(/nothing/i)
  await ui.unmount()
})

test('with auto accept on, a draft that changes while the model works is left alone', { options: { autoAccept: true } }, async ($, on) => {
  const seen: ReturnType<typeof world> = world(on, DRAFT, () => {
    seen.box = `${DRAFT} and add tests`
    return wrap(BETTER)
  })
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.filled).toEqual([])
  expect(seen.toasts.join(' ')).toMatch(/changed/i)
  await ui.unmount()
})

test('with auto accept on, a busy prompt box falls back to the menu', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  seen.isBoxBusy = true
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.box).toBe(DRAFT)
  expect(await isMenuOpen(ui)).toBe(true)
  expect(seen.toasts.join(' ')).toMatch(/busy/i)
  await ui.unmount()
})

const savedEntry = (seen: ReturnType<typeof world>) => JSON.parse(seen.appended[0]?.[5] ?? 'null') as Record<string, unknown>

test('an applied enhance saves the original draft to the history file, in the layout the file uses', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.tails.length).toBe(1)
  expect(seen.tails[0]?.[3]).toBe(HISTORY_FILE)
  expect(seen.appended.length).toBe(1)
  expect(seen.appended[0]?.[4]).toBe(HISTORY_FILE)
  const entry = savedEntry(seen)
  expect(entry).toMatchObject({ display: DRAFT, pastedContents: {}, project: '/work', sessionId: 'sess-1' })
  expect(typeof entry['timestamp']).toBe('number')
  expect(Object.keys(entry)).toEqual(['display', 'pastedContents', 'timestamp', 'project', 'sessionId'])
  expect(seen.toasts.join(' ')).toMatch(/applied/i)
  expect(seen.toasts.join(' ')).toContain('↑')
  await ui.unmount()
})

test('the layout is read from the file each time, so a new key is filled in', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  seen.historyTail = JSON.stringify({
    display: 'x', timestamp: 3, project: '/work', sessionId: 'old', mode: 'chat', pastedContents: {},
  })
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(savedEntry(seen)).toMatchObject({ display: DRAFT, mode: '' })
  await ui.unmount()
})

test('a draft with pasted text is applied but not saved to history, and the toast says why', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on, '[Pasted text #1 +5 lines] fix this', () => wrap('[Pasted text #1 +5 lines] Fix this.'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.box).toBe('[Pasted text #1 +5 lines] Fix this.')
  expect(seen.appended).toEqual([])
  expect(seen.toasts.join(' ')).toMatch(/pasted text or an image/i)
  await ui.unmount()
})

test('a history file in a layout we cannot read is left alone and the toast says so', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  seen.historyTail = 'no entries here'
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.box).toBe(BETTER)
  expect(seen.appended).toEqual([])
  expect(seen.toasts.join(' ')).toMatch(/not recognised/i)
  await ui.unmount()
})

test('a history file that cannot be read or written is reported and the enhance still stands', { options: { autoAccept: true } }, async ($, on) => {
  const unreadable = world(on)
  unreadable.tailExit = 1
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })
  expect(unreadable.box).toBe(BETTER)
  expect(unreadable.appended).toEqual([])
  expect(unreadable.toasts.join(' ')).toMatch(/could not save your original/i)
  await ui.unmount()
})

test('a failed append is reported and the enhance still stands', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  seen.appendExit = 2
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.box).toBe(BETTER)
  expect(seen.appended.length).toBe(1)
  expect(seen.toasts.join(' ')).toMatch(/could not save your original/i)
  await ui.unmount()
})

test('nothing is written to history when nothing was applied', { options: { autoAccept: true } }, async ($, on) => {
  const same = world(on, DRAFT, () => wrap(DRAFT))
  await $.session.start(LIVE)
  const first = await band($)
  await first.press({ key: 'enhance' })
  expect(same.appended).toEqual([])
  await first.unmount()
})

test('a busy prompt box applies nothing and writes nothing to history', { options: { autoAccept: true } }, async ($, on) => {
  const seen = world(on)
  seen.isBoxBusy = true
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.appended).toEqual([])
  await ui.unmount()
})

test('with auto accept off, pressing Apply saves the original to history too', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })
  expect(seen.appended).toEqual([])

  await ui.press({ key: 'apply' })

  expect(seen.box).toBe(BETTER)
  expect(seen.appended.length).toBe(1)
  expect(savedEntry(seen)).toMatchObject({ display: DRAFT })
  await ui.unmount()
})

test('the menu Apply button carries the same shortcut', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const button = (await ui.find({ type: 'Button', text: /Apply/ })) as unknown as { props?: { action?: string } }

  expect(button.props?.action).toBe('app:toggleDiffNoiseFilter')
  await ui.unmount()
})

test('Apply puts the enhanced text in the box and closes the menu', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  await ui.press({ key: 'apply' })

  expect(seen.filled).toEqual([BETTER])
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('Dismiss closes the menu and leaves the draft alone', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  await ui.press({ key: 'dismiss' })

  expect(seen.filled).toEqual([])
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('typing a character dismisses the menu', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const r = await splice($, { text: DRAFT, cursor: DRAFT.length, start: DRAFT.length, end: DRAFT.length, inputText: '!' })

  expect(r.text).toBe(`${DRAFT}!`)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('moving the cursor keeps the menu open', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  await splice($, { text: DRAFT, cursor: 5, start: 2, end: 2, inputText: '' })

  expect(await isMenuOpen(ui)).toBe(true)
  await ui.unmount()
})

test('sending the prompt closes the menu', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  await $.prompt.submit({ text: DRAFT, wait: false, origin: { kind: 'composer' as const } })

  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('an empty draft is not sent to the model', async ($, on) => {
  const seen = world(on, '   ')
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.calls).toBe(0)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('a reply that changes nothing opens no menu and says so', async ($, on) => {
  const seen = world(on, DRAFT, () => wrap(DRAFT))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.toasts.join(' ')).toMatch(/nothing/i)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('a reply that drops an image tag is refused', async ($, on) => {
  const seen = world(on, 'make a calculator like in [Image #1]', () => wrap('Make a calculator like in the image'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.toasts.join(' ')).toMatch(/could not/i)
  expect(seen.toasts.join(' ')).toMatch(/dropped/i)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('a model that does not answer is reported with its reason', async ($, on) => {
  const seen = world(
    on,
    DRAFT,
    () => ({ value: { isAnswered: false as const, reason: 'timeout' as const, usage } }) as never,
  )
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.toasts.join(' ')).toMatch(/did not answer.*timeout/i)
  await ui.unmount()
})

test('a model failure leaves the draft as it was', async ($, on) => {
  const seen = world(
    on,
    DRAFT,
    () => ({ value: { isAnswered: false as const, reason: 'aborted' as const, usage } }) as never,
  )
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.toasts.join(' ')).toMatch(/could not/i)
  expect(seen.filled).toEqual([])
  await ui.unmount()
})

const KEYS = JSON.stringify({
  bindings: [{ context: 'Global', bindings: { 'ctrl+x r': 'app:toggleDiffNoiseFilter' } }],
})

const hasText = async (ui: { find: (query: { type: 'Text'; text: RegExp }) => Promise<unknown> }, text: RegExp) =>
  (await ui.find({ type: 'Text', text })) !== undefined

test('the menu is one diff: the old line under a minus, the new line under a plus', async ($, on) => {
  world(on, 'clear the cash now', () => wrap('clear the cache now'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /^−$/)).toBe(true)
  expect(await hasText(ui, /^\+$/)).toBe(true)
  expect(await hasText(ui, /^cash$/)).toBe(true)
  expect(await hasText(ui, /^cache$/)).toBe(true)
  expect(await hasText(ui, /1 change/)).toBe(true)
  expect(await hasText(ui, /chars/)).toBe(true)
  await ui.unmount()
})

test('the menu has no change list and no view tabs', async ($, on) => {
  world(on, 'clear the cash now', () => wrap('clear the cache now'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /^changes/)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'view-inline' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apply' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'dismiss' })).toBeDefined()
  await ui.unmount()
})

test('Apply puts the model rewrite in the box as it is, punctuation and layout included', async ($, on) => {
  const seen = world(on, 'it is broke, so can u look.\nthanks', () => wrap('It is broken, so can you look?\n\nThanks'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })
  await ui.press({ key: 'apply' })

  expect(seen.filled).toEqual(['It is broken, so can you look?\n\nThanks'])
  await ui.unmount()
})

test('the menu shows the rewrite as it will be applied, punctuation included', async ($, on) => {
  world(on, 'it is broke, so can u look.\nthanks', () => wrap('It is broken, so can you look?\n\nThanks'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /look\?/)).toBe(true)
  await ui.unmount()
})

test('a rewrite that changes only punctuation or layout still opens the menu and says no word changed', async ($, on) => {
  world(on, 'fix the login, then the logout', () => wrap('fix the login. then the logout!'))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await isMenuOpen(ui)).toBe(true)
  expect(await hasText(ui, /no word changes/)).toBe(true)
  await ui.unmount()
})

test('unchanged lines around a change are context, and a long run folds to a count', async ($, on) => {
  const draft = ['intro', 'a', 'b', 'c', 'd', 'e', 'f', 'fix cash'].join('\n')
  world(on, draft, () => wrap(draft.replace('cash', 'cache')))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /6 unchanged lines/)).toBe(true)
  expect(await hasText(ui, /^f$/)).toBe(true)
  expect(await hasText(ui, /^intro$/)).toBe(false)
  await ui.unmount()
})

test('the idle button takes no room: it is mounted in a box of no height', async ($, on) => {
  world(on)
  const ui = await band($)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.includes('"height":0')).toBe(true)
  expect(await ui.find({ type: 'Button', text: /Enhance Prompt/ })).toBeDefined()
  await ui.unmount()
})

test('the menu hint names the shortcut bound in keybindings.json', async ($, on) => {
  const seen = world(on)
  seen.keys = KEYS
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })
  expect(await hasText(ui, /Ctrl\+X R applies/)).toBe(true)
  await ui.unmount()
})

test('with no shortcut bound the hint says "the shortcut"', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /the shortcut applies/)).toBe(true)
  await ui.unmount()
})

test('the band steps aside for a survey', async ($, on) => {
  world(on)
  const ui = await band($, { hasSurvey: true })
  expect(await ui.find({ type: 'Button', text: /Enhance Prompt/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /baseline/ })).toBeDefined()
  await ui.unmount()
})

test('another plugin band under rescribe still draws, idle and with the menu open', async ($, on) => {
  world(on)
  await $.session.start(LIVE)
  const ui = await band($)

  expect(await ui.find({ type: 'Text', text: /baseline/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Enhance Prompt/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /below/ })).toBeDefined()

  await ui.press({ key: 'enhance' })
  expect(await ui.find({ type: 'Text', text: /baseline/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /below/ })).toBeDefined()
  expect(await isMenuOpen(ui)).toBe(true)
  await ui.unmount()
})

test('a draft that changes while the model works is left alone and no menu opens', async ($, on) => {
  const seen: ReturnType<typeof world> = world(on, DRAFT, () => {
    seen.box = `${DRAFT} and add tests`
    return wrap(BETTER)
  })
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await isMenuOpen(ui)).toBe(false)
  expect(seen.toasts.join(' ')).toMatch(/changed/i)
  expect(seen.filled).toEqual([])
  await ui.unmount()
})

test('Apply will not overwrite a box that no longer holds the reviewed draft', async ($, on) => {
  const seen = world(on)
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })
  seen.box = `${DRAFT} and add tests`

  await ui.press({ key: 'apply' })

  expect(seen.filled).toEqual([])
  expect(seen.toasts.join(' ')).toMatch(/changed/i)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

test('a reply that differs only in surrounding whitespace counts as nothing to improve', async ($, on) => {
  const seen = world(on, `${DRAFT}\n`, () => wrap(DRAFT))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.toasts.join(' ')).toMatch(/nothing/i)
  expect(await isMenuOpen(ui)).toBe(false)
  await ui.unmount()
})

const DIFF_DRAFT = 'clear the cash now'
const DIFF_FIXED = 'clear the cache now'

test('a review opens the diff in a pane and asks for the rows it needs', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.opened).toHaveLength(1)
  expect(seen.opened[0]?.id).toBe(PANE_ID)
  expect(seen.opened[0]?.title).toBe('Enhance Prompt')
  expect(seen.opened[0]?.rows ?? 0).toBeGreaterThan(0)
  await ui.unmount()
})

test('with the pane up, the band keeps the title, the count and the buttons but not the diff', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(await hasText(ui, /Enhance Prompt/)).toBe(true)
  expect(await hasText(ui, /1 change/)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'apply' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'dismiss' })).toBeDefined()
  expect(await hasText(ui, /^−$/)).toBe(false)
  expect(await hasText(ui, /^cache$/)).toBe(false)
  await ui.unmount()
})

test('the pane draws the whole diff', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const view = await pane($)

  expect(await hasText(view, /^−$/)).toBe(true)
  expect(await hasText(view, /^\+$/)).toBe(true)
  expect(await hasText(view, /^cash$/)).toBe(true)
  expect(await hasText(view, /^cache$/)).toBe(true)
  await view.unmount()
  await ui.unmount()
})

type Styled = { props?: { backgroundColor?: string; bold?: boolean; dimColor?: boolean; color?: string } }

const styleOf = async (view: Awaited<ReturnType<typeof pane>>, text: RegExp): Promise<Styled['props']> =>
  ((await view.find({ type: 'Text', text })) as unknown as Styled).props

test('the pane opens with a header: a title and the lines removed and added', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const view = await pane($)

  expect(await hasText(view, /^Changes$/)).toBe(true)
  expect(await styleOf(view, /^−1$/)).toMatchObject({ color: 'error' })
  expect(await styleOf(view, /^\+1$/)).toMatchObject({ color: 'success' })
  await view.unmount()
  await ui.unmount()
})

test('changed words sit on the strong tint and bold, the rest of the row stays plain', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const view = await pane($)

  expect(await styleOf(view, /^cash$/)).toMatchObject({ backgroundColor: 'diffRemovedWord', bold: true })
  expect(await styleOf(view, /^cache$/)).toMatchObject({ backgroundColor: 'diffAddedWord', bold: true })
  expect((await styleOf(view, /^clear the/))?.dimColor).toBeFalsy()
  expect((await styleOf(view, /^clear the/))?.backgroundColor).toBeUndefined()
  await view.unmount()
  await ui.unmount()
})

test('removed and added rows are tinted across the whole width', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)
  await ui.press({ key: 'enhance' })

  const view = await pane($)
  const tree = JSON.stringify(await view.drawn())

  expect(tree).toContain('"backgroundColor":"diffRemoved"')
  expect(tree).toContain('"backgroundColor":"diffAdded"')
  await view.unmount()
  await ui.unmount()
})

test('a pane that cannot be placed is closed and the band shows the whole diff', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.closed).toEqual([PANE_ID])
  expect(await hasText(ui, /^cache$/)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'apply' })).toBeDefined()
  await ui.unmount()
})

test('Apply, Dismiss, typing and sending each close the pane', async ($, on) => {
  const seen = world(on, DIFF_DRAFT, () => wrap(DIFF_FIXED))
  seen.isPanePlaced = true
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })
  await ui.press({ key: 'apply' })
  expect(seen.closed).toEqual([PANE_ID])

  seen.box = DIFF_DRAFT
  await ui.press({ key: 'enhance' })
  await ui.press({ key: 'dismiss' })
  expect(seen.closed).toEqual([PANE_ID, PANE_ID])

  await ui.press({ key: 'enhance' })
  await splice($, { text: DIFF_DRAFT, cursor: 3, start: 3, end: 3, inputText: '!' })
  expect(seen.closed).toEqual([PANE_ID, PANE_ID, PANE_ID])

  await ui.press({ key: 'enhance' })
  await $.prompt.submit({ text: DIFF_DRAFT, wait: false, origin: { kind: 'composer' as const } })
  expect(seen.closed).toEqual([PANE_ID, PANE_ID, PANE_ID, PANE_ID])
  await ui.unmount()
})

test('with nothing to review the pane says so', async ($, on) => {
  world(on)
  await $.session.start(LIVE)

  const view = await pane($)

  expect(await hasText(view, /nothing to review/i)).toBe(true)
  await view.unmount()
})

test('a draft over the size limit is not sent to the model', async ($, on) => {
  const seen = world(on, 'x '.repeat(6000))
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })

  expect(seen.calls).toBe(0)
  expect(seen.toasts.join(' ')).toMatch(/too long/i)
  await ui.unmount()
})

test('a model call that throws is reported, and the shortcut works again afterwards', async ($, on) => {
  let isFirst = true
  const seen: ReturnType<typeof world> = world(on, DRAFT, () => {
    if (isFirst) {
      isFirst = false
      throw new Error('network down')
    }
    return wrap(BETTER)
  })
  await $.session.start(LIVE)
  const ui = await band($)

  await ui.press({ key: 'enhance' })
  expect(seen.toasts.join(' ')).toMatch(/could not/i)
  expect(await isMenuOpen(ui)).toBe(false)

  await ui.press({ key: 'enhance' })
  expect(await isMenuOpen(ui)).toBe(true)
  await ui.unmount()
})
