# prompt-repair

Fixes your prompt before Claude sees it: misheard or wrong words, typos, fillers and self-corrections. By default it shows you the fix first.

## The review menu

In `review` mode (the default) a fixed prompt is held back and a menu opens above the prompt box:

```
╭──────────────────────────────────────────────────────────╮
│ ✎ Prompt repair  1 change                                │
│ was clear the cash when the user logs out                │
│ now clear the cache when the user logs out               │
│ cash → cache                                             │
│                                                          │
│ 1: Send fixed  2: Edit  3: Send original  4: Always auto │
╰──────────────────────────────────────────────────────────╯
```

- `1` **Send fixed** sends the fixed prompt.
- `2` **Edit** puts the fixed prompt back in the prompt box. Sending it again skips the repair.
- `3` **Send original** sends what you typed.
- `4` **Always auto** switches to `auto` mode and sends the fixed prompt.

The digits work while the prompt box is empty, which it is while the menu is open. Typing a new prompt instead replaces the held one. A prompt with nothing to fix goes straight through. Only prompts typed in the prompt box are held; others are fixed and sent.

In `auto` mode nothing is held: the fix is applied and a toast shows what changed.

## How it works

0. **Cleanup (no model).** Stuttered function words (`the the`, `and and`, `is is`, `just just`) collapse to one, and spoken fillers (`um`, `uh`, `er`, `hmm`) are removed. Emphasis doubles (`very very`, `no no`) stay. Code, URLs and paths are never touched. Spoken symbols are rewritten the same way: `cloud dot md` → `cloud.md`, `1.25 e minus 3` → `1.25e-3`, `3 bit` → `3-bit`.
1. **Scan (no model).** Each prompt is checked against a dictionary of known mishearings and against near-misses of project terms. Code, URLs, paths, flags, slash commands and `!` shell prompts are skipped.
2. **Fix (Haiku).** Every prompt gets one Haiku call with one prompt. It returns the prompt you meant to send: misheard words, real words that change the meaning (`cash` for `cache`), typos, fillers, false starts, and self-corrections (`no wait, I mean...`, keeping the final version). It does not polish, reword or add anything. When the scan found glossary hits, those lines are added to the same prompt.
3. **Guards.** A reply is used only if it has `<fixed>` tags, is not much longer or shorter than your prompt (so it answered or summarised nothing), and every code span, URL, path and flag from your prompt is still in it. Anything else, or any model failure, sends your prompt unchanged.

## Learning (no model)

The dictionary learns from what you type next:

- `I meant X`, `I mean X`, `X not Y`, `not Y, X`, `Y -> X`
- `actually it's X`, `wait it's X` (also `its`, `it is`, `no wait`). The whole message must be that phrase, and X must sound like a word in your last prompt.
- a near-identical resend of the last prompt
- A repair you undo (`I said Y`) is dropped and not repeated.

Fixes only add pairs that are already known or that name a project term.

## Commands

```
/prompt-repair                 status
/prompt-repair on | off
/prompt-repair review | auto
/prompt-repair list
/prompt-repair add heard=meant
/prompt-repair rm heard
```

State lives in `$.store` under `dictionary`, `enabled` and `mode`.

## Develop

```
claude plugin test <dir>
claude plugin validate <dir>
```

Defaults are in `src/glossary.ts`.
