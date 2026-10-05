export type Entry = {
  heard: string
  meant: string
  source: 'default' | 'learned' | 'manual'
  at?: number
}

export type Pair = { heard: string; meant: string }

export type Dictionary = {
  learned: Entry[]
  rejected: string[]
}
