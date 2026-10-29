export type Config = {
  cache: boolean
  timeout: number
}

const whole = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export const readOptions = (o: Readonly<Record<string, unknown>>): Config => ({
  cache: o['cache'] === 'sudo',
  timeout: whole(o['timeoutSeconds'], 10, 600, 120),
})
