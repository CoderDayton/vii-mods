import type { Filter } from '../../core/types'
import type { Params } from './database'

export type Clause = { sql: string; params: Params }

const KIND = /^[a-z]+$/

// The WHERE conditions of a filter over a table that has project, kind, ts and session columns, with
// each value bound as a parameter. `alias` prefixes the column names.
export const clauseOf = (filter: Filter, alias = ''): Clause => {
  const col = (name: string): string => (alias === '' ? name : `${alias}.${name}`)
  const parts: string[] = []
  const params: Params = {}

  if (filter.project !== undefined && filter.project !== '') {
    parts.push(`instr(lower(${col('project')}), lower($project)) > 0`)
    params.project = filter.project
  }
  if (filter.kinds !== undefined && filter.kinds.length > 0) {
    const kinds = filter.kinds.filter(k => KIND.test(k))
    parts.push(`${col('kind')} in (${kinds.map(k => `'${k}'`).join(', ')})`)
  }
  if (filter.since !== undefined) {
    parts.push(`${col('ts')} >= $since`)
    params.since = Math.trunc(filter.since)
  }
  if (filter.excludeSession !== undefined && filter.excludeSession !== '') {
    parts.push(`${col('session')} <> $excludeSession`)
    params.excludeSession = filter.excludeSession
  }
  return { sql: parts.length === 0 ? 'true' : parts.join(' and '), params }
}
