const PATTERNS: readonly RegExp[] = [
  /\b(did|didn'?t|have|haven'?t|weren'?t|wasn'?t) (we|you|i)\b/,
  /\bhow did (we|you|i)\b/,
  /\bwhat (did|was|were) (we|you|that|the)\b/,
  /\b(last|previous|earlier) (time|session|conversation)\b/,
  /\bremember (when|that|how|the)\b|\bdo you remember\b/,
  /\balready (did|done|fixed|tried|solved|discussed|decided|have|had|made)\b/,
  /\b(another|a previous|an earlier|the other|a past) session\b/,
  /\bearlier\b.*\?|\bwe (decided|discussed|agreed|talked about|settled)\b/,
]

// Whether a prompt asks about work done before, which is when a search of past sessions is worth its cost.
export const asksAboutPast = (prompt: string): boolean => {
  const text = prompt.toLowerCase()
  return PATTERNS.some(p => p.test(text))
}
