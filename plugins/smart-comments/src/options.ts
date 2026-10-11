export type Config = { max: number; allowDocs: boolean; notify: boolean }

const DEFAULT_MAX = 3
const MIN_MAX = 0
const MAX_MAX = 20

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => {
  const max = o['maxPlain']
  const docs = o['allowDocstrings']
  return {
    max: typeof max === 'number' && Number.isFinite(max) ? Math.min(MAX_MAX, Math.max(MIN_MAX, Math.floor(max))) : DEFAULT_MAX,
    allowDocs: typeof docs === 'boolean' ? docs : true,
    notify: o['notify'] === true,
  }
}
