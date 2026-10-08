# fleet-board

One pane for the other Claude sessions you run. See who is working and who went quiet, brief a session, ping it, hand it a task, stop it, or open a new one without leaving this session.

Run `/fleet` to open the pane.

```
7 sessions · 2 working · 1 on the team

  ● 1: glowseed-garden-16         working  1m
       glowseed-garden
  ○ 5: quorum-63                  idle     2h
       quorum
▸ ○ 8: claude-mods-82             idle     now
       claude-mods · Specialist

▸ claude-mods-82
Task: what should it do? Enter sends
[ Ping ]  [ Brief as ]  Specialist ▾  [ Stop run ]
[ Ping team ]  [ New session ]  [ Disband ]  [ Refresh ]  [ Close ]
```

## The pane

Sessions come from the registry Claude Code keeps in its config folder, so every session on the machine is listed, in the terminal or the desktop app. The list refreshes every 4 seconds while the pane is open.

| Key | Does |
| --- | --- |
| `1` to `9` | Pick a session |
| `p` | Ping it: ask for a one-line status |
| `b` | Brief it as the role in the picker |
| `s` | Tell it to stop its run and wait |
| Enter in the task box | Send it a task |
| `t` | Ping every session on the team |
| `d` | Tell the team it is disbanded |
| `n` | Open a new session |
| `r` / `c` | Refresh / close |

A working session that has not changed state for 30 minutes gets a `!`. That is the one that went quiet.

## Opening a session

Press `n`, pick a folder and a role, optionally type a first task, and press Enter or `o`. The pane starts `claude` in that folder, waits for the session to appear, briefs it, then sends the task.

Where it opens depends on the `launcher` option:

- `auto`: a terminal window when the machine has a display and ghostty or wezterm, otherwise a background tmux session. The pane then prints `tmux attach -t <name>`.
- `ghostty`, `wezterm`, `tmux`: use that one.

The folder list holds this project, the folders of running sessions, and the folders next to this project. For any other folder use `/fleet new <folder>`.

## Roles and the briefing

The three roles and the briefing text are the ones in the `boss` skill: specialist, local execution, research. A briefed session is told to reply "ready", keep its work until it gets a task, and report done or blocked. Briefed sessions make up the team. The team is remembered for this session only.

## Commands

Everything the pane does can be typed, so a script or the model can drive it.

| Command | Does |
| --- | --- |
| `/fleet` | Open the pane |
| `/fleet list` | List the other sessions |
| `/fleet ping <session\|team>` | Ask for a one-line status |
| `/fleet brief <session> <role>` | Brief it (`specialist`, `local` or `research`) |
| `/fleet task <session> <text>` | Hand it a task |
| `/fleet stop <session>` | Tell it to stop its run |
| `/fleet new <folder> [role] [task]` | Open a session and brief it (role defaults to `specialist`) |
| `/fleet disband` | Tell the team it is disbanded |
| `/fleet close` | Close the pane |

A session is its row number, its name, its folder name, or the start of its name.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `launcher` | `auto` | Where new sessions open: `auto`, `ghostty`, `wezterm` or `tmux` |
| `claudeArgs` | empty | Extra arguments for the `claude` command of new sessions, split on spaces. Example: `--model opus` |
| `quietMinutes` | `30` | How long a working session may stay unchanged before it gets a `!` (5 to 600) |

## Limits

- Messages are sent to a session you pick. Other sessions are never messaged on their own, so `Ping team` and `Disband` reach only sessions you briefed.
- A reply from a session arrives in this conversation as a message. The pane does not read replies; the state column comes from the registry.
- A new session opens with the `claude` command as your shell finds it. Add flags such as a permission mode with `claudeArgs`.
- The registry format belongs to Claude Code. If a session record lacks an id, a process id or a folder, it is skipped.
