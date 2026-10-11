export const MAX_TERMS = 8

// Words that frame a question about the past or only hold a sentence together. None of them says what the
// question is about.
const FILLER = new Set(
  (
    'a an the this that these those it its is are was were be been am do does did didn have has had i you we us our my me ' +
    'and or but not no yes so if then than there here to of in on at by for with from as into about ' +
    'what which who whom whose how why when where can could would should will shall may might must ' +
    'last time ago again already remember earlier before previously ever just also very'
  ).split(' '),
)

// The words of a text to look for as keywords: lower case, identifiers whole, a path or a flag split at its
// punctuation, filler and one-letter words left out, each word once.
export const termsOf = (text: string, max: number = MAX_TERMS): string[] => {
  const seen = new Set<string>()
  for (const word of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    if (word.length > 1 && !FILLER.has(word)) seen.add(word)
  }
  return [...seen].slice(0, max)
}
