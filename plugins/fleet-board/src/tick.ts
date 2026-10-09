// Runs `fn` on each call, except that a call made while an earlier run is still going returns at once. A run that
// throws frees the next call; its error goes to the caller that started it.
export const exclusive = <A extends unknown[]>(fn: (...args: A) => Promise<void>): ((...args: A) => Promise<void>) => {
  let running = false
  return async (...args: A) => {
    if (running) return
    running = true
    try {
      await fn(...args)
    } finally {
      running = false
    }
  }
}
