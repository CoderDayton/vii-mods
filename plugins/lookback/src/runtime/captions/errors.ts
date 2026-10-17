// The caption server did not start or did not answer. The images wait for the next run.
export class CaptionUnavailableError extends Error {
  override readonly name = 'CaptionUnavailableError'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
  }
}

export class CaptionRejectedError extends Error {
  override readonly name = 'CaptionRejectedError'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
  }
}
