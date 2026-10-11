const MAX_CHARS = 500
const MAX_LINES = 6

// Wording that pushes back on what Claude did. It only has to be cheap and loose: the model decides.
const PUSHBACK =
  /\b(?:no|not|never|stop|wrong|incorrect|again|still|instead|should|supposed to|(?:do|does|did|is|are|was|were|has|have|wo|ca|should|could|would)n'?t|i (?:said|told|asked|meant|wanted))\b/i

export const mightCorrect = (text: string): boolean => {
  const t = text.trim()
  if (t === '' || t.startsWith('/') || t.length > MAX_CHARS) return false
  if (t.split('\n').length > MAX_LINES) return false
  return PUSHBACK.test(t)
}
