# sudo-askpass

Claude's Bash tool has no terminal, so `sudo` cannot ask for a password and the
call fails. This mod gives it one. Each `sudo` call opens a dialog on your
screen that shows the command and asks for your password. The password goes
from the dialog to `sudo` and nowhere else: Claude, the transcript and the hook
never see it. Cancel, or a timeout, fails the call.

## How it works

1. A `tool.call` hook on Bash finds each `sudo` that starts a command: after
   `;`, `&&`, `||`, `|`, `&`, `(`, `$(`, a newline, or variable assignments.
2. It rewrites `sudo ...` to `sudo -k -A ...` and exports `SUDO_ASKPASS`
   (this mod's `bin/askpass.sh`), plus the original command for the dialog.
3. `sudo` runs the helper, which shows a `zenity` dialog.
4. `-k` makes every call ask again. Set `cache` to `sudo` to let sudo reuse its
   own cached login for a few minutes instead.

Left alone: calls that already pick how to authenticate (`-A`, `-n`), bare
`sudo -k` / `-K`, and any `sudo` inside quotes. `sudo -S` is refused, because
it reads the password from stdin.

## Settings

| Option | Default | |
|---|---|---|
| `cache` | `every` | `every` asks on every call. `sudo` uses sudo's own cached login. |
| `timeoutSeconds` | `120` | How long the dialog waits before the call fails. |

## Needs

- `zenity` and a graphical session (`DISPLAY` or `WAYLAND_DISPLAY`).
- A `sudo` that supports `-A` and `SUDO_ASKPASS`. Tested with sudo-rs 0.2.13.

## When not to use this

- Over SSH or on a machine with no display: the dialog has nowhere to appear.
  Run `! sudo ...` in the prompt instead.
- If you approve dialogs without reading them. The dialog is the only gate; a
  password typed on autopilot approves whatever it shows.
- `sudo` inside `bash -c '...'`, `xargs sudo` or `env sudo` is not rewritten
  and fails with "A terminal is required".

## Tests

```
claude plugin test plugins/sudo-askpass
```
