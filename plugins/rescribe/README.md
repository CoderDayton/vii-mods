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

A mod cannot add its own action name; Claude Code ignores unknown ones. rescribe's buttons name this built-in action instead. It is unbound by default and does nothing outside the old diff panel, so the chord presses rescribe's button and nothing else. The binding must be a chord or a modified key. Without it, nothing opens the menu, because the idle button has no visible row to click.

## Use

1. Type a draft.
2. Press the shortcut. A model call rewrites the draft (Haiku on high effort by default). The draft stays in the box. The diff opens in a pane, and a two-row menu above the prompt holds the title, the count and the buttons:

```
✎ Enhance Prompt  2 changes · 29 → 29 chars
[ Apply ]  [ Dismiss ]  Ctrl+X R applies · typing dismisses
```

The pane docks beside the transcript at full height in fullscreen from 110 columns, and sits above the prompt otherwise. If the terminal cannot place a pane, the diff shows under the menu in a frame, and long diffs scroll there.

The pane opens with a `Changes −N +M` header and a rule. The diff is a normal one: removed lines under `−` and added lines under `+`, each tinted edge to edge in the theme's own diff colors, the changed words bold on a stronger tint, unchanged lines around a change dimmed, and long unchanged runs folded to `⋯ N unchanged lines`. Lines wrap at any terminal width.

3. Press the shortcut again or click **Apply** to put the text in the box. Type or click **Dismiss** to keep your draft. Enter sends as usual.

Apply puts the rewrite in the box exactly as the menu shows it. The model rewrites for clarity (goal, then context, then constraints, as short paragraphs or bullets) and keeps names, paths, URLs, code, `[Image #N]` tags, `@file` mentions and hedges. It adds nothing and does not answer the draft. A clear draft comes back unchanged unless an edit meaningfully improves it, and you get a "nothing to improve" toast. A rewrite that changes only punctuation or layout still opens the menu, labelled `no word changes`.

`Ctrl+X Tab` focuses the menu, then `Tab` and `Enter` pick a button.

The menu and the pane close when you edit the text or send. If you close the pane yourself, the diff moves into the menu. Apply works only if the box still holds the reviewed draft.

A draft that is empty or over 10,000 characters is not sent. A reply is refused, and the draft kept, when it has no `<enhanced>` tags, is over 2.5 times the draft plus 80 characters, shares under 30% of the draft's words (so it answered the draft instead of rewriting it), or loses an `[Image #N]` tag, `@file` mention, code span, URL or path. The toast names the reason. Editing the draft while the model works discards the result.

When idle, the band above the prompt draws nothing. The shortcut only works while its button is mounted, so the button sits in a box with no height. The band steps aside for a survey, and draws under the plugins beneath it, as `gpu-lock` does. A plugin above it that skips `next` unmounts the button, and the shortcut stops working.

## Settings

In `/plugin`, or under `pluginConfigs` in your settings:

- `model`: `haiku` (default), `sonnet`, `opus` or a full model id.
- `effort`: `high` (default), `low`, `medium`, `xhigh` or `max`. Any other value counts as `high`.
- `autoAccept`: off by default. When on, the enhanced text goes into the prompt box right away with an `applied` toast and no menu opens. If the box is busy or its text changed, the menu opens or nothing is applied, as usual.
- `timeoutSeconds`: 20 by default, from 5 to 120.

## Files

- `hooks/register.tsx`: the `ui.render` hooks (the idle button, the menu, the diff pane and the model call), and the `prompt.edit`, `prompt.submit` and `ui.close` hooks that keep them in step.
- `src/enhance.ts`: the instructions sent to the model and the checks on its reply.
- `src/options.ts`: the settings.
- `src/ui.tsx`: the idle button, the menu and the diff pane, and the action name.
- `src/view.ts`: the diff rows: line diff, context and folds.
- `src/diff.ts`: the word diff behind the marks and the change count.
- `src/chord.ts`: finds your shortcut in `keybindings.json`.

## Develop

```
claude plugin test <dir>
claude plugin validate <dir>
```
