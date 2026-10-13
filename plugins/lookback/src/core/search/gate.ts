// How near a past entry must be to a prompt, by meaning, to count as an answer to it.
export const MIN_SIMILARITY = 0.8
// How many telling words the entry and the prompt must share.
export const MIN_SHARED = 2
// A word held by more than this share of entries does not tell one entry from another.
export const COMMON_SHARE = 0.05
// A shorter prompt, or one that is a command or a tool's output, is not a question about the past.
export const MIN_PROMPT_CHARS = 25

export const worthAsking = (prompt: string): boolean => {
  const text = prompt.trim()
  return text.length >= MIN_PROMPT_CHARS && !text.startsWith('/') && !text.startsWith('<')
}

// The terms that tell entries apart: held by some entry, and by few of the `total`. `counts` holds, for each
// term, how many entries hold it.
export const tellingTerms = (terms: readonly string[], counts: readonly number[], total: number): string[] =>
  terms.filter((_, i) => (counts[i] ?? 0) > 0 && (counts[i] ?? 0) / Math.max(1, total) <= COMMON_SHARE)

export const sharedTerms = (text: string, terms: readonly string[]): string[] => {
  const lower = text.toLowerCase()
  return terms.filter(t => lower.includes(t))
}

export const answers = (similarity: number, text: string, telling: readonly string[]): boolean =>
  similarity >= MIN_SIMILARITY && sharedTerms(text, telling).length >= MIN_SHARED
