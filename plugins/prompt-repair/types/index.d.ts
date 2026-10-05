export type Pair = { heard: string; meant: string }

export type Review = {
  original: string
  fixed: string
  pairs: Pair[]
  learn: Pair[]
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-repair': {
      review: Review | null
    }
  }
}
