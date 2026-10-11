// A rough stem: enough for "users" to meet "user" and "caches" to meet "cache".
const stem = (word: string): string => {
  let s = word
  if (s.length > 4 && s.endsWith('ing')) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2)
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1)
  return s.length > 3 && s.endsWith('e') ? s.slice(0, -1) : s
}

// The stemmed words of prose or code. A name is split at its humps and underscores.
export const wordsOf = (s: string): string[] =>
  (
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z]{2,}/g) ?? []
  ).map(stem)

const setOf = (list: string): ReadonlySet<string> => new Set(list.split(' ').map(stem))

const FILLER = setOf(
  'the an of to in on for and or is are be this that these those it its with from by as at into over out up we our if then so each all any here there will when which whether what who how can may also just very than them they their has have was were been being param return returns',
)

// Verbs and nouns that say an action happens without saying which.
const EMPTY = setOf(
  'get set do does make call use run perform handle check create add update initialize init define declare loop iterate go start begin end put take give helper function method variable value',
)

const RULE = setOf(
  'must never always only unless not cannot before after until under below above exceed otherwise because since avoid ensure require assume invariant guarantee careful beware trap gotcha workaround hack race deadlock overflow underflow leak unsafe safety important warning note else',
)

export const hasRuleWord = (text: string): boolean => wordsOf(text).some(w => RULE.has(w))

// Words a keyword or operator in the code stands for.
const SPOKEN: readonly (readonly [RegExp, string])[] = [
  [/\+\+|\+= ?1\b/, 'increment'],
  [/--|-= ?1\b/, 'decrement'],
  [/\b(import|require|use)\b/, 'import load'],
  [/\b(throw|raise)\b/, 'throw raise error'],
  [/\b(catch|except|rescue)\b/, 'catch error exception'],
  [/\b(print|println|console\.log|echo)\b/, 'print log output'],
  [/\b(delete|del)\b/, 'delete remove'],
  [/\bawait\b/, 'wait await'],
  [/\bnew\b|\{\}|\[\]/, 'new empty instance'],
]

const codeWords = (code: string): Set<string> => {
  const known = new Set(wordsOf(code))
  for (const [seen, said] of SPOKEN) if (seen.test(code)) for (const w of wordsOf(said)) known.add(w)
  return known
}

// The share of a comment's words that the code beside it does not already say: 0 when the code says all
// of them, 1 when it says none. Null for a comment with no word that could carry meaning.
export const newness = (text: string, code: string): number | null => {
  const words = [...new Set(wordsOf(text))].filter(w => !FILLER.has(w) && !EMPTY.has(w) && !RULE.has(w))
  if (words.length === 0) return null
  const known = codeWords(code)
  return words.filter(w => !known.has(w)).length / words.length
}
