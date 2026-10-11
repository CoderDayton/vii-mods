import type { Filter } from '../../core/types'
import type { Params } from './database'
import { clauseOf } from './filters'

export const MAX_TERMS = 12

export type LexicalQuery = { sql: string; params: Params }

const HAS_WORD = /[\p{L}\p{N}]/u

// The FTS5 query for a list of terms: any of them, or all of them, each as a quoted phrase so nothing in it
// reads as query syntax, and each open at the end so "cache" also finds "cached" and "CachedResolver". Null
// when no term holds a letter or a digit, which FTS5 cannot match.
export const matchExpression = (terms: readonly string[], join: 'OR' | 'AND' = 'OR'): string | null => {
  const phrases = [...new Set(terms.map(t => t.toLowerCase().trim()).filter(t => HAS_WORD.test(t)))]
    .slice(0, MAX_TERMS)
    .map(t => `"${t.replaceAll('"', '""')}"*`)
  return phrases.length === 0 ? null : phrases.join(` ${join} `)
}

// A BM25 ranking of the entries that hold any of the terms, best first. FTS5 reports a better match as a
// lower number, so the score is that number negated.
export const lexicalQuery = (terms: readonly string[], limit: number, filter: Filter): LexicalQuery | null => {
  const match = matchExpression(terms)
  if (match === null) return null
  const where = clauseOf(filter, 'e')
  const sql = `
    select e.id as id, -bm25(entries_fts) as score
    from entries_fts join entries e on e.id = entries_fts.rowid
    where entries_fts match $match and ${where.sql}
    order by score desc, e.id desc
    limit ${Math.max(1, Math.trunc(limit))}`
  return { sql, params: { ...where.params, match } }
}
