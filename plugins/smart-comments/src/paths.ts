// Folders, under the home directory, that hold installed skills and plugins.
const INSTALLED = ['.agents/skills', '.claude/skills', '.claude/plugins']

// Whether a path, as spelled, is inside an installed skill or plugin. A link is not followed here.
export const isInstalled = (path: string, home: string): boolean => home !== '' && INSTALLED.some(dir => path.startsWith(`${home}/${dir}/`))

// The path from the root, with `.`, `..` and doubled slashes taken out, so two spellings of one file
// give one path. A link is not followed.
export const absolute = (path: string, cwd: string): string => {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}
