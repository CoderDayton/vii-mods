import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { cleanCaption } from '../../src/runtime/images'
import { indexAll, refreshSession } from '../../src/runtime/indexer'
import { searchPast } from '../../src/runtime/search'
import { Store } from '../../src/runtime/store/store'
import { FakeCaptions, FakeEmbedder, Projects, pasteRow, tempDir, userRow } from './helpers'

let projects: Projects
let tmp: ReturnType<typeof tempDir>
let store: Store

beforeEach(() => {
  projects = new Projects()
  tmp = tempDir()
  store = Store.open(join(tmp.path, 'index.sqlite'))
})

afterEach(() => {
  store.close()
  projects.remove()
  tmp.remove()
})

const run = (captions: FakeCaptions | null, embedder: FakeEmbedder | null = null) => indexAll(store, { projectsRoot: projects.root, embedder, captions })

const images = (): { path: string; caption: string }[] =>
  store.sessionEntries('s1', { limit: 50, offset: 0, kinds: ['image'] }).map(e => {
    const [path = '', ...rest] = e.text.split('\n')
    return { path, caption: rest.join('\n') }
  })

test('with no caption source, pasted images are left alone and nothing is written beside the index', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] why is the pane cut off?', ['settings pane cut off'], { session: 's1' })])
  const report = await run(null)
  expect(report.images).toBe(0)
  expect(store.stats().byKind.image).toBeUndefined()
  expect(existsSync(join(tmp.path, 'images'))).toBe(false)
})

test('a pasted image is kept beside the index, private, and found by its caption', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] why is the pane cut off?', ['settings pane cut off'], { session: 's1' })])
  const captions = new FakeCaptions()
  const report = await run(captions)
  expect(report).toMatchObject({ images: 1, captionError: null })
  expect(captions).toMatchObject({ opened: 1, closed: 1, seen: ['image/png settings pane cut off'] })

  const [image] = images()
  expect(image?.caption).toBe('A screenshot that reads: settings pane cut off')
  expect(image?.path.startsWith(join(tmp.path, 'images'))).toBe(true)
  expect(image?.path.endsWith('.png')).toBe(true)
  expect(readFileSync(image!.path, 'utf8')).toBe('settings pane cut off')
  expect(statSync(image!.path).mode & 0o777).toBe(0o600)

  const [hit] = (await searchPast(store, null, 'screenshot settings pane', { now: Date.now(), kinds: ['image'] })).hits
  expect(hit?.entries[0]?.kind).toBe('image')
})

test('the same image pasted twice is captioned and kept once', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['the same screenshot'], { session: 's1', uuid: 'u1' })])
  projects.write('proj', 's2', [pasteRow('[Image #1] again', ['the same screenshot'], { session: 's2', uuid: 'u2' })])
  const captions = new FakeCaptions()
  expect((await run(captions)).images).toBe(2)
  expect(captions.seen).toHaveLength(1)
  expect(store.stats().byKind.image).toBe(2)
})

test('a run with no new image starts no caption server', async () => {
  const path = projects.write('proj', 's1', [pasteRow('[Image #1] look', ['first screenshot'], { session: 's1' })])
  const captions = new FakeCaptions()
  await run(captions)
  projects.append(path, [userRow('and now a plain question about the parser', { session: 's1' })])
  await run(captions)
  expect(captions.opened).toBe(1)
})

test('transcripts read before captions were on have their pastes captioned once they are', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['an old screenshot'], { session: 's1' })])
  await run(null)
  const captions = new FakeCaptions()
  expect((await run(captions)).images).toBe(1)
  expect(images()[0]?.caption).toContain('an old screenshot')
})

test('pastes read while captions were off again are found when they come back on', async () => {
  const path = projects.write('proj', 's1', [pasteRow('[Image #1] look', ['first screenshot'], { session: 's1', uuid: 'u1' })])
  const captions = new FakeCaptions()
  await run(captions)
  await run(null)
  projects.append(path, [pasteRow('[Image #2] and this', ['second screenshot'], { session: 's1', uuid: 'u2' })])
  await run(null)
  expect(store.stats().byKind.image).toBe(1)
  expect((await run(captions)).images).toBe(1)
  expect(store.stats().byKind.image).toBe(2)
})

test('when the caption server cannot start, the pastes wait for the next run', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['a screenshot'], { session: 's1' })])
  const captions = new FakeCaptions()
  captions.down = true
  const report = await run(captions)
  expect(report.captionError).toContain('down')
  expect(store.stats().byKind.image).toBeUndefined()
  captions.down = false
  expect((await run(captions)).images).toBe(1)
})

test('an image the model fails on does not stop the others, and is tried again later', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] [Image #2] look', ['broken screenshot', 'good screenshot'], { session: 's1' })])
  const captions = new FakeCaptions()
  captions.failing.add('broken screenshot')
  const first = await run(captions)
  expect(first.images).toBe(1)
  expect(first.captionError).toBeNull()
  captions.failing.clear()
  expect((await run(captions)).images).toBe(1)
  expect(store.stats().byKind.image).toBe(2)
})

test('an image the model keeps failing on is given up after three runs, so it raises no error for ever', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] [Image #2] look', ['bad one', 'bad two'], { session: 's1' })])
  const captions = new FakeCaptions()
  captions.failing.add('bad one')
  captions.failing.add('bad two')
  for (let i = 0; i < 3; i++) expect((await run(captions)).captionError).toContain('cannot read')
  const fourth = await run(captions)
  expect(fourth.captionError).toBeNull()
  expect(captions.opened).toBe(3)
})

test('the saved path is shown with a caption but neither matched by words nor embedded', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['a screenshot of the build log'], { session: 's1' })])
  const embedder = new FakeEmbedder()
  await run(new FakeCaptions(), embedder)
  expect(images()[0]?.path.endsWith('.png')).toBe(true)
  expect((await searchPast(store, null, 'png', { now: Date.now(), kinds: ['image'] })).hits).toEqual([])
  expect((await searchPast(store, null, 'build log', { now: Date.now(), kinds: ['image'] })).hits).toHaveLength(1)
  expect(embedder.calls.flatMap(c => c.texts).join(' ')).not.toContain('.png')
})

test('a caption stuck in a loop is cut, and a secret on screen is not stored', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['keys page'], { session: 's1' })])
  await run(new FakeCaptions(() => `API keys sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 ${'0 '.repeat(100)}`))
  expect(images()[0]?.caption).toBe('API keys [redacted:anthropic-key] 0')
})

test('a paste read while a prompt waits is captioned by the next full run', async () => {
  const path = projects.write('proj', 's1', [userRow('a first question about the parser', { session: 's1' })])
  const captions = new FakeCaptions()
  await run(captions)
  projects.append(path, [pasteRow('[Image #1] what is this?', ['a fresh screenshot'], { session: 's1', uuid: 'u9' })])
  await refreshSession(store, { projectsRoot: projects.root, session: 's1', embedder: null })
  expect(captions.opened).toBe(0)
  expect(store.stats().byKind.image).toBeUndefined()
  expect((await run(captions)).images).toBe(1)
})

test('captions get vectors like any other entry', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['a screenshot of the build log'], { session: 's1' })])
  const embedder = new FakeEmbedder()
  await run(new FakeCaptions(), embedder)
  expect(store.pending(10)).toEqual([])
  expect(embedder.calls.flatMap(c => c.texts).join(' ')).toContain('build log')
})

test('the rest of the index gets its vectors before any image is captioned', async () => {
  projects.write('proj', 's1', [userRow('why does the parser drop the last token of a line?', { session: 's1' }), pasteRow('[Image #1] look', ['a screenshot of the parser'], { session: 's1', uuid: 'u2' })])
  let waiting = -1
  const captions = new FakeCaptions(bytes => {
    waiting = store.countPending()
    return `A screenshot that reads: ${bytes}`
  })
  await run(captions, new FakeEmbedder())
  expect(waiting).toBe(0)
  expect(store.pending(10)).toEqual([])
})

test('while the caption server cannot be reached, no image is given up', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] [Image #2] look', ['first screenshot', 'second screenshot'], { session: 's1' })])
  const captions = new FakeCaptions()
  captions.unreachable = true
  for (let i = 0; i < 4; i++) expect((await run(captions)).captionError).toContain('unreachable')
  expect(captions.seen).toHaveLength(4)
  captions.unreachable = false
  expect((await run(captions)).images).toBe(2)
})

test('a forgotten session has its pastes left out and none written beside the index', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['a forgotten screenshot'], { session: 's1' })])
  await run(null)
  expect(store.forget('s1', Date.now())).toBeGreaterThan(0)
  await run(new FakeCaptions())
  expect(existsSync(join(tmp.path, 'images')) ? readdirSync(join(tmp.path, 'images')) : []).toEqual([])
})

test('image files gone from the folder do not stop the others being captioned', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] [Image #2] [Image #3] look', ['first screenshot', 'second screenshot', 'third screenshot'], { session: 's1' })])
  const captions = new FakeCaptions()
  captions.down = true
  await run(captions)
  captions.down = false
  const dir = join(tmp.path, 'images')
  const [a, b] = readdirSync(dir).sort()
  rmSync(join(dir, a!))
  rmSync(join(dir, b!))
  const report = await run(captions)
  expect(report).toMatchObject({ images: 1, captionError: null })
})

test('forgetting a session deletes the images only it held', async () => {
  projects.write('proj', 's1', [pasteRow('[Image #1] look', ['mine alone', 'shared one'], { session: 's1', uuid: 'u1' })])
  projects.write('proj', 's2', [pasteRow('[Image #1] look', ['shared one'], { session: 's2', uuid: 'u2' })])
  await run(new FakeCaptions())
  const [alone, shared] = images()
  store.forget('s1', Date.now())
  expect(existsSync(alone!.path)).toBe(false)
  expect(existsSync(shared!.path)).toBe(true)
})

test('a stray </think> is removed and the text on both sides of it is kept', () => {
  expect(cleanCaption('A red button.\n</think>\n\nText: Go')).toBe('A red button.\n\nText: Go')
  expect(cleanCaption('A red button.\n</think>')).toBe('A red button.')
  expect(cleanCaption('</think>\nA red button. </think> Text: Go')).toBe('A red button.  Text: Go')
  expect(cleanCaption('A red button.</think>Text: Go')).toBe('A red button. Text: Go')
  expect(cleanCaption('A red button.')).toBe('A red button.')
})
