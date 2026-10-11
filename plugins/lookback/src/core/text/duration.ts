const UNIT_MS = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 } as const

// A span such as "12h", "30d" or "2w" in milliseconds, or null when the text is not one.
export const durationMs = (text: string): number | null => {
  const match = /^([1-9]\d*)([hdw])$/.exec(text.trim())
  return match === null ? null : Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS]
}
