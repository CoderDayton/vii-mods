import { expect, test } from 'bun:test'

import { SqliteLibraryError, sqliteLibraryFor } from '../../src/runtime/store/library'

const ARM = '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib'
const INTEL = '/usr/local/opt/sqlite/lib/libsqlite3.dylib'
const only = (...paths: string[]) => (path: string) => paths.includes(path)

test('Linux and Windows use the SQLite inside Bun', () => {
  expect(sqliteLibraryFor('linux', {}, only())).toBeNull()
  expect(sqliteLibraryFor('win32', {}, only())).toBeNull()
})

test('macOS uses the Homebrew SQLite, Apple silicon first, then Intel', () => {
  expect(sqliteLibraryFor('darwin', {}, only(ARM, INTEL))).toBe(ARM)
  expect(sqliteLibraryFor('darwin', {}, only(INTEL))).toBe(INTEL)
})

test('macOS with no SQLite that loads extensions says how to get one', () => {
  expect(() => sqliteLibraryFor('darwin', {}, only())).toThrow(SqliteLibraryError)
  expect(() => sqliteLibraryFor('darwin', {}, only())).toThrow(/brew install sqlite/)
  expect(() => sqliteLibraryFor('darwin', {}, only())).toThrow(/LOOKBACK_SQLITE_LIB/)
})

test('LOOKBACK_SQLITE_LIB names the library on any system, and must exist', () => {
  expect(sqliteLibraryFor('darwin', { LOOKBACK_SQLITE_LIB: '/x/libsqlite3.dylib' }, only('/x/libsqlite3.dylib', ARM))).toBe('/x/libsqlite3.dylib')
  expect(sqliteLibraryFor('linux', { LOOKBACK_SQLITE_LIB: '/x/libsqlite3.so' }, only('/x/libsqlite3.so'))).toBe('/x/libsqlite3.so')
  expect(sqliteLibraryFor('linux', { LOOKBACK_SQLITE_LIB: '' }, only())).toBeNull()
  expect(() => sqliteLibraryFor('darwin', { LOOKBACK_SQLITE_LIB: '/gone.dylib' }, only(ARM))).toThrow(/\/gone\.dylib/)
})
