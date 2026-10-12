import type { Mixer } from './mixer'

// A gap this long between two calls means the caller was held up; the missed time is not written.
const STALL_MS = 200

export type PumpTiming = {
  // How far ahead of the clock sound is written. A clip that starts while the stream is fed is heard
  // this much later, so it is kept as small as the player's reads allow.
  leadMs: number
  // Silence written ahead of the first clip after the stream ran dry. The player drops the start of
  // what it is handed then, and this is what it drops.
  prerollMs: number
  // How long the stream is fed silence after the last clip ends, so the next key finds it running.
  holdMs: number
}

// Decides how much of the mix to write to the player, and when. The player reads at the speed it
// plays, so audio written far ahead cannot have a later clip mixed in: the pump stays only `leadMs`
// ahead of the clock.
export class Pump {
  readonly #mixer: Mixer
  readonly #rate: number
  readonly #timing: PumpTiming
  // The clock time the running stretch began at, and the frames written since. Null while idle.
  #startedAt: number | null = null
  #written = 0
  #lastSoundAt = 0

  constructor(mixer: Mixer, rate: number, timing: PumpTiming) {
    this.#mixer = mixer
    this.#rate = rate
    this.#timing = timing
  }

  get isIdle(): boolean {
    return this.#startedAt === null && this.#mixer.isIdle
  }

  #frames(ms: number): number {
    return Math.floor((ms * this.#rate) / 1000)
  }

  // The stereo samples to write at clock time `nowMs` (milliseconds), or null when none are due.
  due(nowMs: number): Int16Array | null {
    if (this.isIdle) return null
    const isCold = this.#startedAt === null
    const startedAt = this.#startedAt ?? nowMs
    const behind = this.#frames(nowMs - startedAt + this.#timing.leadMs) - this.#written
    const isStalled = behind > this.#frames(STALL_MS)
    if (isCold || isStalled) {
      this.#startedAt = nowMs
      this.#written = 0
    }
    const frames = isCold || isStalled ? this.#frames(this.#timing.leadMs) : behind
    if (frames <= 0) return null
    if (!this.#mixer.isIdle) this.#lastSoundAt = nowMs
    const mix = this.#mixer.render(frames)
    this.#written += frames
    if (this.#mixer.isIdle && nowMs - this.#lastSoundAt >= this.#timing.holdMs) this.#startedAt = null
    if (!isCold) return mix
    const out = new Int16Array(this.#frames(this.#timing.prerollMs) * 2 + mix.length)
    out.set(mix, out.length - mix.length)
    return out
  }
}
