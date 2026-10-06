# rescribe

A prompt enhancer that works in place. You press a shortcut, rescribe rewrites the draft in the prompt box, and a menu shows what would change. Nothing is sent or dropped, so pasted images and `@file` mentions stay attached.

## Set up the shortcut

Bind a chord to the action `app:toggleDiffNoiseFilter` in `~/.claude/keybindings.json`, in the `Global` block:

```json
{
  "context": "Global",
  "bindings": {
    "ctrl+x r": "app:toggleDiffNoiseFilter"
  }
}
```

A mod cannot add its own action name; Claude Code ignores unknown ones. rescribe's buttons name this built-in action instead. It is unbound by default and does nothing outside the old diff panel, so the chord presses rescribe's button and nothing else. The binding must be a chord or a modified key. Without it, click the `✎ rescribe` row above the prompt.

## Use

1. Type a draft.
2. Press the shortcut. A model call rewrites the draft (Sonnet on low effort by default). The draft stays in the box, and a menu opens above it:

```
╭──────────────────────────────────────────────────────────╮
│ ✎ rescribe  2 changes · 29 → 29 chars                    │
│ [ Apply ]  [ Dismiss ]  Ctrl+X R applies · typing dism…  │
│                                                          │
│ − make a calculator in python and make it good           │
│ + Make a calculator in Python and make it good           │
╰──────────────────────────────────────────────────────────╯
```

The menu is one normal diff: removed lines under a red `−`, added lines under a green `+`, the changed words in bold, and unchanged lines around a change as dim context. A run of more than a few unchanged lines folds to `⋯ N unchanged lines`. The layout is flexbox, so each line wraps under its own text at any terminal width. The hint names your own shortcut, read from `keybindings.json`.

3. Press the shortcut again, or click **Apply**, to put the new text in the box. Keep typing, or click **Dismiss**, to keep your draft. Press Enter as usual to send.

Apply puts the model's rewrite in the box, and the menu shows that same text. The instructions ask the model to reword concisely, fix errors and cut filler, and to put the goal first, then context, then constraints, as short paragraphs, steps or bullets. It must keep names, paths, URLs, code, `[Image #N]` tags and `@file` mentions as they are. It must not add requirements, steps or questions, drop a fact or a hedge ("I think", "maybe"), answer the task, or change the language. A clear draft comes back with light edits or none. Wording and punctuation may change. A rewrite that changes no word, only punctuation or layout, still opens the menu and says `no word changes`.

`Ctrl+X Tab` focuses the menu so `Tab` and `Enter` can pick a button from the keyboard.

The menu closes when you change the text or send the prompt. Moving the cursor keeps it open. Apply puts the new text in the box only if the box still holds the draft that was reviewed.

Nothing is sent to the model, and you get a toast, when the draft is empty or over 10,000 characters. A reply is refused, and the draft left alone, when it has no `<enhanced>` tags, is longer than 1.5 times the draft plus 80 characters, shares fewer than half of the draft's words (so the model answered it instead of rewriting it, checked for drafts of 4 or more distinct words), or loses an `[Image #N]` tag, an `@file` mention, a code span, a URL or a path. If you edit the draft while the model works, the result is thrown away. A reply that only differs in surrounding whitespace counts as nothing to improve.

While nothing is open, the band above the prompt is one dim `✎ rescribe` row. It steps aside for a survey. The row cannot be hidden: a button that is not laid out (`display: none`, or zero height) is not mounted, and the shortcut stops working.

The band is one tree, so rescribe draws under what the plugins beneath it draw, and `gpu-lock` does the same. A plugin above it that draws without calling `next` hides the row.

## Settings

In `/plugin`, or under `pluginConfigs` in your settings:

- `model`: `sonnet` (default, Sonnet 5.5), `haiku`, `opus` or a full model id.
- `effort`: `low` (default), `medium`, `high`, `xhigh` or `max`. Any other value counts as `low`.
- `timeoutSeconds`: 20 by default, from 5 to 120.

## Files

- `hooks/register.tsx`: the `ui.render` hook (the idle row, the menu and the model call), a `prompt.edit` hook and a `prompt.submit` hook that close the menu.
- `src/enhance.ts`: the instructions sent to the model and the checks on its reply.
- `src/options.ts`: the settings.
- `src/ui.tsx`: the idle row and the menu, and the action name.
- `src/view.ts`: the diff rows: line diff, context and folds.
- `src/diff.ts`: the word diff behind the marks and the change count.
- `src/chord.ts`: finds your shortcut in `keybindings.json`.

## Develop

```
claude plugin test <dir>
claude plugin validate <dir>
```
