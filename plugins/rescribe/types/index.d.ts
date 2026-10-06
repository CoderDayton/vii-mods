export type Pair = { heard: string; meant: string }

export type Review = {
  original: string
  fixed: string
  pairs: Pair[]
}

declare module 'claude-code' {
  interface PluginState {
    rescribe: {
      review: Review | null
    }
  }
}
