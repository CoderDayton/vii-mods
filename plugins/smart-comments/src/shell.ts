// A file `git status` lists as changed. `path` is relative to the repository root.
export type StatusFile = { path: string; isNew: boolean }

// Reads `git status --porcelain -z`: entries end in NUL, and a rename or copy is followed by its old
// name. Deleted files are left out.
export const parseStatus = (out: string): StatusFile[] => {
  const parts = out.split('\0')
  const files: StatusFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    if (status.includes('R') || status.includes('C')) i++
    if (status.includes('D')) continue
    files.push({ path: entry.slice(3), isNew: status === '??' || status.includes('A') })
  }
  return files
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// Whether a shell command of the turn names the file. A file no command names was made by a tool the
// command ran, such as a generator or a formatter, and is not judged.
export const mentions = (commands: readonly string[], path: string): boolean => {
  const name = nameOf(path)
  return name !== '' && commands.some(c => c.includes(name))
}

const COPIES = /(^|[\s;&|(])(cp|mv|rsync|ln|git\s+mv)\s/

// Whether a command that names the file copies or moves files. A new file put in place that way
// came with its comments: nobody wrote them this turn.
export const isCopied = (commands: readonly string[], path: string): boolean => {
  const name = nameOf(path)
  return name !== '' && commands.some(c => c.includes(name) && COPIES.test(c))
}
