// A run of this many copies of one word or phrase, back to back, is a model stuck in a loop, not a screen.
const MIN_COPIES = 5
// The longest phrase, in words, looked for.
const MAX_UNIT = 8

// The text up to the end of the first copy of a phrase that repeats MIN_COPIES times in a row, or the whole
// text when none does. Small vision models fall into such loops on grids, lists and repeated labels.
export const cutLoop = (text: string): string => {
  const words = [...text.matchAll(/\S+/g)]
  const same = (a: number, b: number, size: number): boolean => {
    for (let k = 0; k < size; k++) if (words[a + k]?.[0] !== words[b + k]?.[0]) return false
    return true
  }
  for (let i = 0; i < words.length; i++) {
    for (let size = 1; size <= MAX_UNIT && i + size * MIN_COPIES <= words.length; size++) {
      let copies = 1
      while (copies < MIN_COPIES && same(i, i + copies * size, size)) copies++
      if (copies === MIN_COPIES) {
        const last = words[i + size - 1]!
        return text.slice(0, last.index + last[0].length)
      }
    }
  }
  return text
}
