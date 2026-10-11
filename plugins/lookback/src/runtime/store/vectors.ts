import type { Database } from 'bun:sqlite'

export type VectorSpace = { model: string; dimension: number }

const TABLE = 'chunks'
const COLUMN = 'embedding'

// A vector as the extension stores it: 32-bit floats, in the byte order of the machine.
export const encodeVector = (vector: readonly number[]): Uint8Array => new Uint8Array(Float32Array.from(vector).buffer)

// Tells the extension, for this connection, what the vector column holds. Every connection must do this
// before it scans.
export const initVectors = (db: Database, dimension: number): void => {
  db.query('select vector_init($table, $column, $options)').get({
    table: TABLE,
    column: COLUMN,
    options: `dimension=${Math.trunc(dimension)},type=FLOAT32,distance=COSINE`,
  })
}

// Builds the 8-bit copy of the vectors that a compact scan reads. It is a snapshot: rows stored later are
// not in it until it is built again. INT8 keeps the angle between vectors, which cosine distance measures;
// the extension's default for all-positive data (UINT8) does not.
export const quantizeVectors = (db: Database): void => {
  db.query('select vector_quantize($table, $column, $options)').get({ table: TABLE, column: COLUMN, options: 'qtype=INT8' })
}

export const dropQuantized = (db: Database): void => {
  db.query('select vector_quantize_cleanup($table, $column)').get({ table: TABLE, column: COLUMN })
}

// The scan to read from: the compact copy when it covers every stored vector, else the vectors themselves.
// Both stream every row with its cosine distance (0 to 2) from the query vector.
export const scanFunction = (compact: boolean): string => `${compact ? 'vector_quantize_scan' : 'vector_full_scan'}('${TABLE}', '${COLUMN}', $query)`
