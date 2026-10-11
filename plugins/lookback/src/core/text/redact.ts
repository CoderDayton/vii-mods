// How every marker starts; the kind and a closing bracket follow.
export const REDACTED_MARK = '[redacted:'

type Rule = { kind: string; pattern: RegExp; keep?: string }

const mark = (kind: string): string => `${REDACTED_MARK}${kind}]`

// A value that reads as a generated secret: long, from the alphabet keys are written in, with a letter and a
// digit. `getToken(request)` and `string` do not qualify, so code that only names a secret is left alone.
const LITERAL = String.raw`(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{12,}`
const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*`

// Checked in order: a key with a known shape is named for its service before a general rule can take it.
// `keep` is put back before the marker, from the first group of the pattern.
const RULES: readonly Rule[] = [
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: 'aws-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google-key', pattern: /\bAIza[A-Za-z0-9_-]{35}/g },
  { kind: 'stripe-key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'bearer', pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g, keep: '$1' },
  { kind: 'password', pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi, keep: '$1' },
  { kind: 'secret', pattern: new RegExp(String.raw`(\b${SECRET_NAME}["']?\s*[:=]\s*["']?)${LITERAL}`, 'gi'), keep: '$1' },
]

// The text with every secret it holds replaced by a marker such as `[redacted:github-token]`. The index
// never stores the secret; the marker keeps the passage searchable for what it was about.
export const redact = (text: string): string => RULES.reduce((out, rule) => out.replace(rule.pattern, `${rule.keep ?? ''}${mark(rule.kind)}`), text)
