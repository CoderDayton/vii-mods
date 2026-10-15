import type { Database } from 'bun:sqlite'

export type VectorSpace = { model: string; dimension: number }

const TABLE = 'chunks'
const COLUMN = 'embedding'

// INT8, not UINT8: unsigned bytes shift every vector by the data's minimum, which changes the angle cosine
// distance measures.
const BYTE_TYPE = 'INT8'

// A vector as stored: one signed byte per value, scaled so its largest magnitude is 127. Cosine distance does
// not depend on a vector's length, so the scale is not kept.
export const encodeVector = (vector: ArrayLike<number>): Uint8Array => {
  let top = 0
  for (let i = 0; i < vector.length; i++) top = Math.max(top, Math.abs(vector[i]!))
  const bytes = new Int8Array(vector.length)
  if (top > 0) for (let i = 0; i < vector.length; i++) bytes[i] = Math.round((127 * vector[i]!) / top)
  return new Uint8Array(bytes.buffer)
}

// Tells the extension, for this connection, what the vector column holds. Every connection must do this
// before it scans, and cannot change it after.
export const initVectors = (db: Database, dimension: number): void => {
  db.query('select vector_init($table, $column, $options)').get({
    table: TABLE,
    column: COLUMN,
    options: `dimension=${Math.trunc(dimension)},type=${BYTE_TYPE},distance=COSINE`,
  })
}

// Every stored vector, nearest first, with its cosine distance (0 to 2) from the query vector bound as
// `$query`. With `nearest`, only that many; without, every one, which lets SQL filter them as they stream.
export const scanOf = (nearest?: number): string =>
  `vector_full_scan('${TABLE}', '${COLUMN}', $query${nearest === undefined ? '' : `, ${Math.max(1, Math.trunc(nearest))}`})`

const BATCH = 5000

// Rewrites vectors stored as 32-bit floats as bytes, and drops the 8-bit copy the extension kept of them. The
// extension drops it only for a column declared as floats, so the connection must be opened again after.
export const floatsToBytes = (db: Database): void => {
  db.run("delete from meta where key = 'compact'")
  const dimension = Number((db.query("select value from meta where key = 'dimension'").get() as { value: string } | null)?.value)
  if (!(dimension > 0)) return
  db.query('select vector_init($table, $column, $options)').get({ table: TABLE, column: COLUMN, options: `dimension=${dimension},type=FLOAT32,distance=COSINE` })
  db.query('select vector_quantize_cleanup($table, $column)').get({ table: TABLE, column: COLUMN })
  const next = db.query('select id, embedding from chunks where id > $after and length(embedding) = $floats order by id limit $batch')
  const put = db.query('update chunks set embedding = $embedding where id = $id')
  for (let after = 0; ; ) {
    const rows = next.all({ after, floats: dimension * 4, batch: BATCH }) as { id: number; embedding: Uint8Array }[]
    if (rows.length === 0) return
    for (const row of rows) {
      const floats = new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength))
      put.run({ id: row.id, embedding: encodeVector(floats) })
    }
    after = rows[rows.length - 1]!.id
  }
}
