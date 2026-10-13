// What a question says about time, read in local time: a span to search in, and whether it asks for the
// newest work. `text` is the question without those words.
export type When = { text: string; since?: number; until?: number; latest: boolean }

type Span = { since: number; until: number }

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// A time of day stands for this long before and after it.
const AROUND_MS = HOUR_MS
const EVENING_HOUR = 18
const MORNING_HOUR = 6

const dayStart = (ts: number, days = 0): number => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime()
}

const monthStart = (ts: number, months = 0): number => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime()
}

// Weeks start on Monday.
const weekStart = (ts: number, weeks = 0): number => dayStart(ts, -((new Date(ts).getDay() + 6) % 7) + 7 * weeks)

const dayOf = (start: number): Span => ({ since: start, until: dayStart(start, 1) })

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY = `(${WEEKDAYS.join('|')})`
const UNIT = '(hour|day|week|month)s?'
const COUNT = '(\\d{1,3}|an?|one|two|three|four|five|six|seven|few|a few|couple|a couple)'
const COUNTS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, few: 3, 'a few': 3, couple: 2, 'a couple': 2 }

const countOf = (word: string | undefined): number => (word === undefined ? 1 : (COUNTS[word.toLowerCase()] ?? Number(word)))

const monthOf = (name: string): number => MONTHS.indexOf(name.toLowerCase().slice(0, 3))

// The day of a month, in the year given or the latest year it has come in.
const dateOf = (now: number, month: number, day: number, year?: string): Span => {
  const y = year === undefined ? new Date(now).getFullYear() : Number(year)
  const start = new Date(y, month, day).getTime()
  return dayOf(year === undefined && start > now ? new Date(y - 1, month, day).getTime() : start)
}

const back = (now: number, count: number, unit: string): number => {
  const u = unit.toLowerCase()
  if (u === 'month') return new Date(now).setMonth(new Date(now).getMonth() - count)
  return now - count * (u === 'hour' ? HOUR_MS : u === 'day' ? DAY_MS : 7 * DAY_MS)
}

type Rule = { pattern: string; span: (m: RegExpMatchArray, now: number) => Span }

// The first rule that matches gives the span. A rule that holds a longer phrase stands before the ones it holds.
const RULES: readonly Rule[] = [
  { pattern: '(\\d{4})-(\\d{2})-(\\d{2})(?![\\dT:-])', span: m => dayOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) },
  { pattern: `${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, span: (m, now) => dateOf(now, monthOf(m[1] ?? ''), Number(m[2]), m[3]) },
  { pattern: `(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+(\\d{4})\\b)?`, span: (m, now) => dateOf(now, monthOf(m[2] ?? ''), Number(m[1]), m[3]) },
  { pattern: 'day\\s+before\\s+yesterday', span: (_, now) => dayOf(dayStart(now, -2)) },
  { pattern: 'last\\s+night', span: (_, now) => ({ since: dayStart(now, -1) + EVENING_HOUR * HOUR_MS, until: dayStart(now) + MORNING_HOUR * HOUR_MS }) },
  { pattern: 'yesterday(?:\\s+(?:morning|afternoon|evening))?', span: (_, now) => dayOf(dayStart(now, -1)) },
  { pattern: '(?:today|tonight|this\\s+(?:morning|afternoon|evening))', span: (_, now) => dayOf(dayStart(now)) },
  { pattern: '(?:earlier\\s+)?this\\s+week', span: (_, now) => ({ since: weekStart(now), until: weekStart(now, 1) }) },
  { pattern: 'last\\s+week', span: (_, now) => ({ since: weekStart(now, -1), until: weekStart(now) }) },
  { pattern: '(?:earlier\\s+)?this\\s+month', span: (_, now) => ({ since: monthStart(now), until: monthStart(now, 1) }) },
  { pattern: 'last\\s+month', span: (_, now) => ({ since: monthStart(now, -1), until: monthStart(now) }) },
  {
    pattern: `${COUNT}\\s+(?:of\\s+)?${UNIT}\\s+ago`,
    span: (m, now) => {
      const then = back(now, countOf(m[1]), m[2] ?? '')
      if (m[2]?.toLowerCase() === 'day') return dayOf(dayStart(then))
      const one = now - back(now, 1, m[2] ?? '')
      return { since: then - one, until: then + one }
    },
  },
  { pattern: `(?:last|past)\\s+(?:${COUNT}\\s+(?:of\\s+)?)?${UNIT}`, span: (m, now) => ({ since: back(now, countOf(m[1]), m[2] ?? ''), until: Infinity }) },
  {
    pattern: `(last\\s+)?${WEEKDAY}`,
    span: (m, now) => {
      const ago = (new Date(now).getDay() - WEEKDAYS.indexOf((m[2] ?? '').toLowerCase()) + 7) % 7
      return dayOf(dayStart(now, -(ago === 0 && m[1] !== undefined ? 7 : ago)))
    },
  },
]

// A month with no day is read only after one of these words: "may" and "march" are words of their own.
const MONTH_ALONE = new RegExp(`\\b(in|during|last|between|from|since|after|before|until)\\s+${MONTH}\\b(?!\\s+\\d)`, 'i')
const ONE_BOUND = new Set(['since', 'after', 'before', 'until'])
const BOUND = '(?:\\b(since|after|before|until)\\s+)?'
const LEAD = '(?:\\b(?:between|through|to|and|or)\\s+)?(?:\\b(?:on|from|in|during|for|over|within)\\s+)?(?:the\\s+)?'
const CLOCK = /\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\w:])/i
const LATEST = /\b(?:latest|newest|most\s+recent(?:ly)?|recent(?:ly)?|lately)\b/i
const LAST_ONE = /\b(?:in\s+)?(?:the\s+|our\s+|my\s+)?last\s+(?:session|conversation|chat|time)\b/i
const QUOTED = /("[^"]*"|'[^']*'|`[^`]*`)/

const bounded = (span: Span, bound: string | undefined): Partial<Span> => {
  const word = bound?.toLowerCase()
  if (word === 'since') return { since: span.since }
  if (word === 'after') return { since: span.until }
  if (word === 'before' || word === 'until') return { until: span.since }
  return span.until === Infinity ? { since: span.since } : span
}

type Read = { rest: string; span?: Partial<Span> }

const readSpan = (text: string, now: number): Read => {
  const month = MONTH_ALONE.exec(text)
  if (month !== null) {
    const start = dateOf(now, monthOf(month[2] ?? ''), 1).since
    const word = month[1]?.toLowerCase()
    return { rest: text.replace(MONTH_ALONE, ' '), span: bounded({ since: start, until: monthStart(start, 1) }, word !== undefined && ONE_BOUND.has(word) ? word : undefined) }
  }
  for (const rule of RULES) {
    const pattern = new RegExp(`${BOUND}${LEAD}(?<![\\w-])(?:${rule.pattern})(?![\\w-])`, 'i')
    const found = pattern.exec(text)
    if (found === null) continue
    const [, bound, ...groups] = found
    return { rest: text.replace(pattern, ' '), span: bounded(rule.span([found[0], ...groups] as RegExpMatchArray, now), bound) }
  }
  return { rest: text }
}

// The hours around a time of day, on the day of the span or today.
const readClock = (text: string, now: number, span: Partial<Span> | undefined): Read => {
  const found = CLOCK.exec(text)
  if (found === null || (found[2] === undefined && found[3] === undefined)) return { rest: text, span }
  const half = found[3]?.toLowerCase()
  const hour = (Number(found[1]) % 12) + (half === 'pm' ? 12 : half === 'am' ? 0 : Number(found[1]) >= 12 ? 12 : 0)
  const at = dayStart(span?.since ?? now) + hour * HOUR_MS + Number(found[2] ?? 0) * 60_000
  return { rest: text.replace(CLOCK, ' '), span: { since: at - AROUND_MS, until: at + AROUND_MS } }
}

const MAX_SPANS = 6

// One span for every time a question names. Whole spans are covered from the first start to the last end:
// "yesterday or last week" is both, and so are two times that cannot both hold. "since" and "before" bound
// that, so "since sept 1 before sept 10" is a range; a start past its end bounds nothing.
const covering = (spans: readonly Partial<Span>[]): Partial<Span> => {
  const whole = spans.filter((s): s is Span => s.since !== undefined && s.until !== undefined)
  const starts = [...whole.map(s => s.since), ...spans.flatMap(s => (s.until === undefined && s.since !== undefined ? [s.since] : []))]
  const ends = [...whole.map(s => s.until), ...spans.flatMap(s => (s.since === undefined && s.until !== undefined ? [s.until] : []))]
  const openEnd = spans.some(s => s.until === undefined) && !spans.some(s => s.since === undefined)
  const openStart = whole.length === 0 && starts.length === 0
  const since = openStart ? undefined : Math.min(...starts)
  const until = openEnd || ends.length === 0 ? undefined : Math.max(...ends)
  if (since !== undefined && until !== undefined && since >= until) return {}
  return { ...(since === undefined ? {} : { since }), ...(until === undefined ? {} : { until }) }
}

export const whenOf = (query: string, now: number): When => {
  const spans: Partial<Span>[] = []
  let latest = false
  let clocked = false
  const parts = query.split(QUOTED).map((part, i) => {
    if (i % 2 === 1) return part
    let rest = part
    for (let n = 0; n < MAX_SPANS; n++) {
      const read = readSpan(rest, now)
      if (read.span === undefined) break
      spans.push(read.span)
      rest = read.rest
    }
    // A time of day belongs to one day; with several times in the question it is dropped.
    const clock = readClock(rest, now, spans.length === 1 ? spans[0] : undefined)
    if (clock.rest !== rest) {
      if (spans.length <= 1 && clock.span !== undefined) spans.splice(0, 1, clock.span)
      clocked = true
      rest = clock.rest
    }
    for (const word of [LATEST, LAST_ONE]) {
      if (!word.test(rest)) continue
      latest = true
      rest = rest.replace(word, ' ')
    }
    return rest
  })
  if (spans.length === 0 && !latest && !clocked) return { text: query, latest }
  const text = parts
    .join('')
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|(?:[,;\s]|\b(?:and|or)$)+$/gi, '')
  return { text, latest, ...covering(spans) }
}
