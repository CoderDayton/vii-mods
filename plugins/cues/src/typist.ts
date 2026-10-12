const DEFAULT_MAX = 30
// The middle wait between two keys, and the share of it a wait may be shorter or longer by.
const KEY_MS = 110
const KEY_SPREAD = 0.3
const WORD_PAUSE_MS = 90

// How long to wait, in ms, after typing `typed` before the next key. `roll` is a random number from 0 to 1.
export const keyDelay = (typed: string, roll: number): number =>
  Math.round(KEY_MS * (1 - KEY_SPREAD + 2 * KEY_SPREAD * roll)) + (/\s/.test(typed) ? WORD_PAUSE_MS : 0)

// The text Claude has written but that has not been "typed" yet, handed out one keystroke at a time.
export class Typist {
  #backlog = ''
  readonly #max: number

  // Past `max` waiting characters the oldest are dropped, so the typing stays near what is on screen.
  constructor(max = DEFAULT_MAX) {
    this.#max = max
  }

  get isEmpty(): boolean {
    return this.#backlog === ''
  }

  push(text: string): void {
    this.#backlog = (this.#backlog + text).slice(-this.#max)
  }

  clear(): void {
    this.#backlog = ''
  }

  // The next character to type, or null. A run of blanks comes back as its first blank only.
  next(): string | null {
    const char = this.#backlog.charAt(0)
    if (char === '') return null
    this.#backlog = /\s/.test(char) ? this.#backlog.replace(/^\s+/, '') : this.#backlog.slice(1)
    return char
  }
}
