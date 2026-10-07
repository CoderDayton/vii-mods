export const PS_ARGV = ['ps', '-e', '-o', 'pid=,ppid='] as const

const MAX_DEPTH = 64

// pid → parent pid, from `ps -e -o pid=,ppid=`.
export const parseParents = (text: string): Map<number, number> => {
  const parents = new Map<number, number>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (m !== null) parents.set(Number(m[1]), Number(m[2]))
  }
  return parents
}

// The nearest job at or above this process in the tree, or null when none owns it.
export const jobOf = (pid: number, jobs: ReadonlySet<number>, parents: ReadonlyMap<number, number>): number | null => {
  let at = pid
  for (let step = 0; step < MAX_DEPTH; step++) {
    if (jobs.has(at)) return at
    const up = parents.get(at)
    if (up === undefined || up <= 0 || up === at) return null
    at = up
  }
  return null
}
