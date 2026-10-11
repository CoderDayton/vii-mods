import type { Hook, Register } from 'claude-code'

import { addedCode, changedRange, crowdAround, freshLines } from '../src/diff'
import { judgeFile, roomFor } from '../src/judge'
import type { Judged } from '../src/judge'
import { FOLLOW_UP, editNote, flaggedIn, turnPrompt } from '../src/note'
import type { FileReport } from '../src/note'
import { readOptions } from '../src/options'
import { absolute, isInstalled } from '../src/paths'
import { isCopied, mentions, parseStatus } from '../src/shell'
import { syntaxOf } from '../src/syntax'
import type { Syntax } from '../src/syntax'

type Engine = Parameters<Hook<'tool.call'>>[0]

const FILE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit'])
const MCP_FILE_TOOL = /^mcp__.+__(write|edit|batch_edit|append)$/
const SHELL_TOOL = 'Bash'
// A file past this size is not read.
const MAX_CHARS = 400_000
const REALPATH_MS = 2000
const GIT_MS = 3000
const MAX_SHELL_FILES = 40

// The file a call writes, as the call spells it, or null for a call that writes none.
const targetOf = (e: { tool: string }): string | null => {
  if (!FILE_TOOLS.has(e.tool) && !MCP_FILE_TOOL.test(e.tool)) return null
  const args = e as { file_path?: unknown; path?: unknown }
  const path = args.file_path ?? args.path
  return typeof path === 'string' && path !== '' ? path : null
}

const textOf = async ($: Engine, path: string): Promise<string | null> => {
  try {
    const text = await $.fs.read(path)
    return text.length > MAX_CHARS ? null : text
  } catch {
    return null
  }
}

// Whether the file belongs to an installed skill or plugin. A path spelled inside one may be a link
// into a checkout: it is followed, and the file it leads to decides.
const isSomeoneElses = async ($: Engine, path: string): Promise<boolean> => {
  const home = (await $.env.get('HOME')) ?? ''
  if (!isInstalled(path, home)) return false
  try {
    const run = await $.process.run(['realpath', '--', path], { timeoutMs: REALPATH_MS })
    const real = run.stdout.trim()
    return run.exitCode !== 0 || real === '' || isInstalled(real, home)
  } catch {
    return true
  }
}

const git = async ($: Engine, root: string, args: readonly string[]): Promise<string | null> => {
  try {
    const run = await $.process.run(['git', '-C', root, ...args], { timeoutMs: GIT_MS })
    return run.exitCode === 0 && !run.isStdoutTruncated ? run.stdout : null
  } catch {
    return null
  }
}

// The files git sees as changed, by absolute path, each marked new or not. Null outside a repository.
type Changed = { root: string; files: Map<string, boolean> }

const changedFiles = async ($: Engine): Promise<Changed | null> => {
  try {
    const root = (await $.session.repo())?.root
    if (root === undefined) return null
    const out = await git($, root, ['status', '--porcelain', '-z', '--untracked-files=all'])
    return out === null ? null : { root, files: new Map(parseStatus(out).map(f => [`${root}/${f.path}`, f.isNew])) }
  } catch {
    return null
  }
}

// A file as it was before Claude wrote it.
type Before = { syn: Syntax; before: string | null }
type Touched = Before & { shown: string }

// The file a call is about to write, read before it runs. Null for a call that is not watched.
const watch = async ($: Engine, e: { tool: string }): Promise<(Touched & { path: string }) | null> => {
  const shown = targetOf(e)
  const syn = shown === null ? null : syntaxOf(shown)
  if (shown === null || syn === null) return null
  const path = absolute(shown, await $.session.cwd())
  if (await isSomeoneElses($, path)) return null
  const before = await textOf($, path)
  // A file that is there but cannot be read, or is too big, is not a new file: its comments are its own.
  if (before === null && (await $.fs.exists(path))) return null
  return { shown, syn, path, before }
}

type Gained = { all: Judged[]; added: Judged[]; max: number }

// What the turn knows when it ends: its shell commands, the files git saw as changed when its prompt
// arrived, and the files it wrote through a file tool.
type Turn = { shell: readonly string[]; start: Changed | null; touched: ReadonlyMap<string, Touched> }

// Files a shell command of the turn named and changed. Only a file that was clean at the prompt counts,
// so its text in HEAD is its text from before the turn.
const shellReports = async ($: Engine, turn: Turn, gained: (path: string, b: Before, after: string) => Gained): Promise<FileReport[]> => {
  if (turn.shell.length === 0 || turn.start === null) return []
  const now = await changedFiles($)
  if (now === null) return []
  const out: FileReport[] = []
  for (const [path, isNew] of now.files) {
    if (out.length >= MAX_SHELL_FILES) break
    const syn = syntaxOf(path)
    if (syn === null || turn.start.files.has(path) || turn.touched.has(path) || !mentions(turn.shell, path)) continue
    if (isNew && isCopied(turn.shell, path)) continue
    if (await isSomeoneElses($, path)) continue
    const shown = path.slice(now.root.length + 1)
    const before = isNew ? null : await git($, now.root, ['show', `HEAD:${shown}`])
    const after = await textOf($, path)
    if (after === null || (!isNew && before === null)) continue
    const { added, max } = gained(path, { syn, before }, after)
    out.push({ path: shown, judged: added, max })
  }
  return out
}

export const register: Register = (on, options) => {
  const config = readOptions(options)
  const touched = new Map<string, Touched>()
  // The shell commands of this turn, and the files git saw as changed when the turn's prompt arrived.
  let shell: string[] = []
  let atPrompt: Promise<Changed | null> | null = null
  let isAsked = false

  // The comments a file gained, judged, with the room its new code earns for plain ones.
  const gained = (path: string, b: Before, after: string): Gained => {
    const lines = freshLines(b.before, after, b.syn)
    const all = judgeFile(path, after, config.allowDocs)
    return {
      all,
      added: all.filter(j => lines.has(j.line) && j.kind !== 'doc'),
      max: roomFor(config.max, addedCode(b.before, after, b.syn)),
    }
  }

  // Every turn of the main loop starts the count again, but the one this mod's follow-up starts: it
  // keeps `isAsked`, so the turn that cleans up is not sent back itself.
  on('turn.start', ($, e, next) => {
    touched.clear()
    shell = []
    atPrompt = changedFiles($)
    if (!e.text.includes(FOLLOW_UP)) isAsked = false
    return next(e)
  })

  // The file is read before the call and after it, so every file tool is handled the same way. The call
  // runs exactly once: a failure of the check on either side leaves its result as it is.
  on('tool.call', async ($, e, next) => {
    const command = e.tool === SHELL_TOOL ? (e as { command?: unknown }).command : undefined
    if (typeof command === 'string') shell.push(command)
    const file = await watch($, e).catch(() => null)
    const out = await next(e)
    if (file === null || out.deny !== undefined || out.isError === true) return out
    try {
      const { shown, syn, path, before } = file
      const after = await textOf($, path)
      if (after === null || after === before) return out
      if (!touched.has(path)) touched.set(path, { shown, syn, before })

      const { all, added, max } = gained(path, { syn, before }, after)
      const crowd = added.length > 0 ? crowdAround(after, all, changedRange(before, after)) : null
      const note = editNote({ path: shown, judged: added, max, crowd, allowDocs: config.allowDocs })
      if (note === null) return out
      if (config.notify) {
        const flagged = flaggedIn(added, max, crowd)
        $.ui.toast(`smart-comments: ${flagged} comment line${flagged === 1 ? '' : 's'} flagged in ${shown}`)
      }
      return { ...out, context: [...(out.context ?? []), note] }
    } catch {
      return out
    }
  })

  // When the main loop answers, each file is judged against its text from before the turn. One prompt
  // for each turn of the user's, so a second miss does not loop.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && !isAsked && (touched.size > 0 || shell.length > 0)) {
      try {
        const files: FileReport[] = []
        for (const [path, t] of touched) {
          const after = await textOf($, path)
          if (after === null) continue
          const { added, max } = gained(path, t, after)
          files.push({ path: t.shown, judged: added, max })
        }
        const start = atPrompt === null ? null : await atPrompt
        files.push(...(await shellReports($, { shell, start, touched }, gained)))
        const prompt = turnPrompt(files, config.allowDocs)
        if (prompt !== null) {
          isAsked = true
          if (config.notify) {
            const failing = files.filter(f => flaggedIn(f.judged, f.max, null) > 0).length
            $.ui.toast(`smart-comments: sent Claude back to fix comments in ${failing} file${failing === 1 ? '' : 's'}`)
          }
          void $.prompt.submit({ text: prompt }).catch(() => undefined)
        }
      } catch {
        // A turn that cannot be checked ends as it would without the mod.
      }
    }
    return next(e)
  })
}
