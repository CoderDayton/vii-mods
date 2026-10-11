import type { Filter } from '../../core/types'
import type { Params } from './database'
import { clauseOf } from './filters'
import { matchExpression } from './lexical'

// The shell commands that hold every term, each once with how often it ran, the most run first and the
// shorter of two equals first. `last` and `project` are those of its latest run: SQLite fills the other
// columns of a row from the one that holds the max.
export const commandQuery = (terms: readonly string[], limit: number, filter: Filter): { sql: string; params: Params } | null => {
  const match = matchExpression(terms, 'AND')
  if (match === null) return null
  const where = clauseOf({ ...filter, kinds: undefined }, 'e')
  const sql = `
    select e.text as text, count(*) as runs, max(e.ts) as last, e.project as project
    from entries_fts join entries e on e.id = entries_fts.rowid
    where entries_fts match $match and e.kind = 'cmd' and ${where.sql}
    group by e.text
    order by runs desc, length(e.text), last desc
    limit ${Math.max(1, Math.trunc(limit))}`
  return { sql, params: { ...where.params, match } }
}
