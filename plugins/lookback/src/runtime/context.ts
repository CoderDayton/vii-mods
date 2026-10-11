import type { HitEntry, SessionHit } from '../core/search/group'
import type { Store } from './store/store'

const FILES_SHOWN = 3

const inTurn = (store: Store, entry: HitEntry): HitEntry => {
  const { start, ...rest } = store.turnOf(entry.id)
  return { ...entry, turn: start, ...rest }
}

// The hits with what surrounds each match: the turn it is in, and the files its session changed.
export const withContext = (store: Store, hits: readonly SessionHit[]): SessionHit[] =>
  hits.map(hit => {
    const files = store
      .sessionFiles(hit.session, FILES_SHOWN)
      .filter(f => f.edits > 0)
      .map(f => f.path)
    return { ...hit, entries: hit.entries.map(e => inTurn(store, e)), ...(files.length === 0 ? {} : { files }) }
  })
