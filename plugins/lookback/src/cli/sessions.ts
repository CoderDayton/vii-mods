import { formatSessionList } from '../core/search/session'
import type { SessionSummary } from '../core/types'
import type { Store } from '../runtime/store/store'
import type { Io } from './io'

// The one session whose id starts with the text. When none or several do, says so on stderr, naming the
// several, and gives null.
export const oneSession = (store: Store, prefix: string, io: Io): SessionSummary | null => {
  const found = store.sessions(prefix)
  if (found.length === 1) return found[0] ?? null
  if (found.length === 0) io.stderr(`lookback: no session starts with "${prefix}"\n`)
  else io.stderr(`lookback: ${found.length} sessions start with "${prefix}"; give more of the id:\n${formatSessionList(found)}\n`)
  return null
}
