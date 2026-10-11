// Blocks the harness and other mods wrap around a prompt. They are not what the user said, and indexing them
// would let a recalled passage find itself again.
const INJECTED_TAGS = ['system-reminder', 'deja-recall', 'lookback-recall', 'local-command-caveat', 'local-command-stdout', 'local-command-stderr']

const INJECTED = new RegExp(`<(${INJECTED_TAGS.join('|')})>[\\s\\S]*?</\\1>`, 'g')

export const stripInjected = (text: string): string => text.replace(INJECTED, '').trim()

// A row Claude Code writes for a slash command, or to mark a turn the user stopped: never prose.
export const isCommandRow = (text: string): boolean => text.trimStart().startsWith('<command-') || /^\s*\[Request interrupted by user[^\]]*\]\s*$/.test(text)
