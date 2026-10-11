// Another process holds the right to write the index: an index run is under way.
export class StoreBusyError extends Error {
  override readonly name = 'StoreBusyError'

  constructor(path: string) {
    super(`the index at ${path} is being updated by another process`)
  }
}

// There is no index to read at the path: no file, or one written by another version.
export class StoreMissingError extends Error {
  override readonly name = 'StoreMissingError'

  constructor(path: string) {
    super(`no index at ${path}; run "lookback index" first`)
  }
}
