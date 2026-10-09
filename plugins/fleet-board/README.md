# fleet-board

One pane for the other Claude sessions you run. Hire sessions as employees, see who is working and who went quiet, send them tasks, stop them, drop them, or open a new one without leaving this session.

Run `/fleet` to open the pane.

```
7 sessions · 2 working · 1 on the team
Hire a session to make it your employee. Then send it tasks.

Your team
▸ ○ 8: claude-mods-82             idle     now
       claude-mods · Specialist

Other sessions
  ● 1: glowseed-garden-16         working  1m
       glowseed-garden
  ○ 5: quorum-63                  idle     2h
       quorum

▸ claude-mods-82
Task: what should it do? Enter sends
[ Ping ]  [ Hire as ]  Specialist ▾  [ Stop run ]  [ Drop from team ]
[ Ping team ]  [ New session ]  [ Disband team ]  [ Refresh ]  [ Close ]
```

## The pane

Sessions come from the registry Claude Code keeps in its config folder, so every session on the machine is listed, in the terminal or the desktop app. The list refreshes every 4 seconds while the pane is open.

| Key | Does |
| --- | --- |
| `1` to `9` | Pick a session |
| `p` | Ping it: ask for a one-line status |
| `b` | Hire it as the role in the picker, or change its role |
| `s` | Tell it to stop its run and wait |
| Enter in the task box | Send it a task |
| Drop from team | Take the picked member off the team (no key) |
| `t` | Ping every session on the team |
| `d` | Disband the team. The first press asks; the second press does it |
| `n` | Open a new session |
| `r` / `c` | Refresh / close |

A working session that has not changed state for 30 minutes gets a `!`. That is the one that went quiet.

## Boss and employees

The session that hires is the boss. Once it has a team, its system prompt says so and lists each employee by name, session id and role. Each employee's system prompt names its boss and the session its reports go to. Both records live in the plugin store, so they survive a restart.

- Hire: `Hire as` sends the briefing and puts the session on the team at once. The row reads `waiting` until the employee's transcript has a reply written after the briefing. Then it reads `ready`. The boss's system prompt shows the same state, read fresh each turn while a member is waiting.
- Drop: removes one member and tells it that it is off the team.
- Disband: tells every member the team is disbanded. Members that cannot be reached are named in the result, and the team is cleared anyway.

## Opening a session

Press `n`, pick a folder and a role, optionally type a first task, and press Enter or `o`. The pane starts `claude` in that folder, waits for the session to appear, briefs it, then sends the task.

Where it opens depends on the `launcher` option:

- `auto`: inside tmux, a new pane beside the current one. Inside WezTerm, a new split pane. Otherwise a new window of ghostty or wezterm when the machine has a display, or a background tmux session the pane names for `tmux attach`.
- `tmux-pane`: split the tmux pane this session runs in.
- `wezterm-pane`: split the WezTerm pane this session runs in.
- `ghostty`, `wezterm`, `tmux`: a new window or a background tmux session.

Ghostty has no command that opens a tab or a split in a running window, so Ghostty gets a new window. To get panes in Ghostty, run Claude inside tmux there; `auto` then splits a tmux pane.

The folder list holds this project, the folders of running sessions, and the folders next to this project. For any other folder use `/fleet new <folder>`.

## Roles and the briefing

The three roles and the briefing text are the ones in the `boss` skill: specialist, local execution, research. A briefed session is told to reply "ready", keep its work until it gets a task, and report done or blocked.

## Commands

Everything the pane does can be typed, so a script or the model can drive it.

| Command | Does |
| --- | --- |
| `/fleet` | Open the pane |
| `/fleet list` | List the other sessions |
| `/fleet ping <session\|team>` | Ask for a one-line status |
| `/fleet brief <session> <role>` | Hire it as a role (`specialist`, `local` or `research`) |
| `/fleet task <session> <text>` | Hand it a task |
| `/fleet stop <session>` | Tell it to stop its run |
| `/fleet drop <session>` | Take it off the team |
| `/fleet new <folder> [role] [task]` | Open a session and brief it (role defaults to `specialist`) |
| `/fleet disband` | Tell the team it is disbanded |
| `/fleet close` | Close the pane |

A session is its row number, its name, its folder name, or the start of its name.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `launcher` | `auto` | Where new sessions open: `auto`, `ghostty`, `wezterm`, `tmux`, `tmux-pane` or `wezterm-pane` |
| `claudeArgs` | empty | Extra arguments for the `claude` command of new sessions, split on spaces. Example: `--model opus` |
| `quietMinutes` | `30` | How long a working session may stay unchanged before it gets a `!` (5 to 600) |

## Limits

- Messages go only to sessions you pick or brief. Other sessions are never messaged on their own.
- A reply is read from the employee's transcript, `~/.claude/projects/<cwd>/<session>.jsonl` under the config folder, and only its last 1 MiB is read. A reply written further back than that is missed. The reply itself still arrives in the employee's own conversation.
- The boss is identified by its session id. A boss that starts a new session has a new id, so its old team stays with the old one.
- Only the three roles exist. A custom role is not available from the pane.
- A new session opens with the `claude` command as your shell finds it. Add flags such as a permission mode with `claudeArgs`.
- The registry format belongs to Claude Code. If a session record lacks an id, a process id or a folder, it is skipped.
