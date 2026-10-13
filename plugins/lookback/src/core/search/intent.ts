type Cue = { name: string; pattern: RegExp; weight: number }

// Text that is not the user's own request: code, quotes, links, image marks, and a "what if" clause.
const MASKS: readonly RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]+`/g,
  /https?:\/\/\S+/g,
  /^[ \t]*>.*$/gm,
  /"[^"\n]{2,800}"|“[^”\n]{2,800}”/g,
  /\[image #\d+\]/g,
  /\bwhat\s+(?:if|about)\b[^.?!\n]*/g,
]

const SPELLING: readonly (readonly [RegExp, string])[] = [
  [/’/g, "'"],
  [/(?<![\w.'])u(?![\w.'])/g, 'you'],
  [/(?<![\w.'])ur(?![\w.'])/g, 'your'],
  [/\b(did|was|were|have|has|had|is|are|do|does|would|could|should)nt\b/g, "$1n't"],
  [/\b(you|we)'ve\b/g, '$1 have'],
  [/\b(how|why|what|where|when)d\b/g, '$1 did'],
  [/\bb4\b/g, 'before'],
  [/\bprev\b/g, 'previous'],
  [/\bconvos?\b/g, 'conversation'],
]

const US = '(?:you|we|i)'
const PAST_VERB = '(?:did|done|made|ran|built|wrote|went|tried|[a-z]{3,}ed)'
const ELSEWHERE = '(?:another|other|previous|prior|last|earlier|past|different|old)'
const TALK = '(?:sessions?|conversations?|chats?|threads?)'

// Each cue is evidence that the prompt points back at something earlier. A weight is how often a prompt
// with that cue alone was one; a cue under 0.5 counts only beside another.
const CUES: readonly Cue[] = [
  { name: 'did-you', pattern: new RegExp(`\\b(?:did|didn't|did not)\\s+${US}\\b(?!\\s+(?:even|know|hear|see|notice|mean|want)\\b)`), weight: 0.9 },
  { name: 'have-you', pattern: new RegExp(`\\b(?:have|haven't|had|hadn't)\\s+${US}\\b(?!\\s+(?:got|to|any|a|an|the|never)\\b)`), weight: 0.8 },
  { name: 'were-you', pattern: new RegExp(`\\b(?:weren't|wasn't)\\s+(?:${US}|it|that)\\b`), weight: 0.8 },
  { name: 'did-it', pattern: /(?:^|[.?!,]\s*|\b(?:and|but|so|wait|ok|okay|or)\s+)did\s+(?:it|that|this|the)\b/m, weight: 0.35 },
  { name: 'what-was', pattern: /\b(?:what|which|who)\s+(?:was|were)\s+(?:the|that|those|your|our|my|its?|measured|decided|chosen|changed|said|used)\b/, weight: 0.75 },
  { name: 'how-much-was', pattern: /\bhow\s+(?:many|much|long|big|fast)\b[^.?!\n]{0,40}\b(?:was|were|did)\b/, weight: 0.7 },
  { name: 'where-from', pattern: /\bwhere\s+did\s+(?:it|that|this|they|those)\s+come\s+from\b/, weight: 0.8 },
  { name: 'you-said', pattern: /\byou\s+(?:have\s+|had\s+|already\s+|previously\s+|originally\s+)?(?:said|told|mentioned|suggested|promised|recommended|showed|claimed|explained|proposed)\b/, weight: 0.85 },
  { name: 'i-gave-you', pattern: /\bi\s+(?:gave|showed|sent)\s+you\s*(?:[,.?!]|$|(?:in|before|earlier)\b)/m, weight: 0.8 },
  {
    name: 'other-session',
    pattern: new RegExp(`\\b(?:in|from|during|at|view|check|lookup|look\\s+up)\\s+(?:the\\s+|a\\s+|an\\s+|our\\s+|my\\s+)?${ELSEWHERE}\\s+${TALK}\\b|\\b(?:last|previous|prior|earlier)\\s+${TALK}\\b|\\banother\\s+session\\b|\\bmy\\s+(?:past\\s+|old\\s+)?sessions\\b`),
    weight: 0.9,
  },
  { name: 'last-time', pattern: /\blast\s+time\b/, weight: 0.8 },
  { name: 'before', pattern: /\b(?:we|you)(?:'ve)?\b(?![^.?!\n]{0,40}\bnever\b)[^.?!\n]{0,40}\bbefore\s*(?:[,.?!]|$|(?:was|were|where|when)\b)|\bbefore\s?hand\b[^.\n]*\?/m, weight: 0.7 },
  { name: 'earlier', pattern: /\b(?:from|said|did|mentioned|ran|made|had|showed)\s+earlier\b|\bearlier\b[^.\n]*\?/, weight: 0.75 },
  { name: 'again', pattern: /\b(?:what|which|who|where|how)\b[^.?!\n]{0,60}\bagain\s*\??\s*$/m, weight: 0.75 },
  { name: 'we-decided', pattern: /\bwe\s+(?:already\s+|had\s+|have\s+)?(?:decided|discussed|agreed|talked|settled|determined|concluded|measured|established)\b/, weight: 0.85 },
  { name: 'was-decided', pattern: /\bit\s+was\s+(?:determined|decided|agreed|concluded|established)\b/, weight: 0.85 },
  { name: 'already', pattern: new RegExp(`\\b(?:you|we)\\s+(?:have\\s+|had\\s+)?already\\s+${PAST_VERB}\\b`), weight: 0.8 },
  { name: 'remember', pattern: /\b(?:do|can)\s+you\s+(?:still\s+)?(?:remember|recall)\b|\bremember\s+(?:when|that|how|what|the)\b|\bremind\s+me\s+(?:what|which|how|why|where|who|of|about)\b/, weight: 0.85 },
  { name: 'forgot', pattern: /\b(?:i\s+)?(?:forgot|don't\s+remember|can't\s+remember)\b/, weight: 0.35 },
  {
    name: 'restore',
    pattern: /\b(?:go|going|went|revert|roll)\s+back\s+to\b(?!\s+(?:main|master|the\s+branch)\b)|\brevert(?:ed)?\s+(?:it\s+)?(?:back\s+)?to\s+(?:the|your|my|our)\s+(?:original|old|previous|earlier|first)\b|\bthe\s+(?:old|previous|original|earlier)\s+(?:version|way|design|look|layout|behaviou?r|approach)\b|\b(?:put|change|make)\s+it\s+back\b|\b(?:like|how)\s+it\s+was\b/,
    weight: 0.8,
  },
]

const THRESHOLD = 0.5

const readable = (prompt: string): string => {
  let text = prompt.toLowerCase()
  for (const mask of MASKS) text = text.replace(mask, m => m.replace(/[^\n]/g, ' '))
  for (const [from, to] of SPELLING) text = text.replace(from, to)
  return text
}

const found = (prompt: string): Cue[] => {
  const text = readable(prompt)
  return CUES.filter(cue => cue.pattern.test(text))
}

export const pastCues = (prompt: string): string[] => found(prompt).map(cue => cue.name)

// How sure the cues make it that a prompt points back at earlier work, 0 to 1: one minus the chance that
// every cue is wrong.
export const pastScore = (prompt: string): number => 1 - found(prompt).reduce((miss, cue) => miss * (1 - cue.weight), 1)

// Whether a prompt asks about work done before, which is when a search of past sessions is worth its cost.
export const asksAboutPast = (prompt: string): boolean => pastScore(prompt) >= THRESHOLD
