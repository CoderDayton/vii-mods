import type { EntryKind } from '../types'

// The numbers the ranking turns on, in one place so they can be scored against a set of questions.
export type Tuning = {
  // The share of meaning in the fused score when both lists stand out alike.
  balance: number
  // The share of meaning stays inside these while both lists hold entries, so neither is silenced.
  minBalance: number
  maxBalance: number
  // The cosine similarity that scales to 0. Entries below it get nothing from meaning.
  meaningFloor: number
  kindWeight: Record<EntryKind, number>
  subAgentWeight: number
  // A session scoring under this share of the best one is left out, unless an entry of it holds every word
  // of the question.
  minShare: number
  // What a session's score is multiplied by when the question names its project folder.
  projectBoost: number
}

const CODE_WEIGHT = 0.85

export const DEFAULT_TUNING: Tuning = {
  balance: 0.5,
  minBalance: 0.15,
  maxBalance: 0.85,
  meaningFloor: 0.5,
  kindWeight: { user: 1.15, error: 1.15, assistant: 1, thinking: 0.9, cmd: CODE_WEIGHT, edit: CODE_WEIGHT },
  subAgentWeight: 0.9,
  minShare: 0.4,
  projectBoost: 1.3,
}

// For a question about the past. Its answer is something Claude said; a prompt that sounds like the question
// is seldom one.
export const ASKED_TUNING: Tuning = { ...DEFAULT_TUNING, kindWeight: { ...DEFAULT_TUNING.kindWeight, user: 0.4, assistant: 1.15 } }
