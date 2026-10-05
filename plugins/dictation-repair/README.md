# dictation-repair

Fixes speech-to-text mishearings in your prompt before Claude sees it.

## How it works

0. **Cleanup (no model).** Stuttered function words (`the the`, `and and`, `is is`, `just just`) collapse to one, and spoken fillers (`um`, `uh`, `er`, `hmm`) are removed. Emphasis doubles (`very very`, `no no`) stay. Code, URLs and paths are never touched. Spoken symbols are rewritten the same way: `cloud dot md` → `cloud.md`, `1.25 e minus 3` → `1.25e-3`, `3 bit` → `3-bit`.
1. **Scan (no model).** Each prompt is checked against a dictionary of known mishearings and against near-misses of project terms. Code, URLs, paths, flags, slash commands and `!` shell prompts are skipped. No hit, no model call.
2. **Repair (Haiku).** Only on a hit, one Haiku call gets the prompt and just the matching glossary lines.
3. **Guards.** The reply is used only if it has `<fixed>` tags, keeps the length within 25%, changes few words, keeps all punctuation, spacing and line breaks as typed, and every change is a sound-alike or a known pair. Anything else, or any model failure, sends your prompt unchanged.
4. **Toast.** Every rewrite shows a toast with the pairs it changed.

## Learning (no model)

The dictionary learns from what you type next:

- `I meant X`, `X not Y`, `not Y, X`, `Y -> X`
- a near-identical resend of the last prompt
- A repair you undo (`I said Y`) is dropped and not repeated.

Repairs only add pairs that are already known or that name a project term.

## Commands

```
/dictation                 status
/dictation on | off
/dictation list
/dictation add heard=meant
/dictation rm heard
```

State lives in `$.store` under `dictionary` and `enabled`.

## Develop

```
claude plugin test <dir>
claude plugin validate <dir>
```

Defaults are in `src/glossary.ts`.
