# fleet-board

A read-only pane for the other Claude sessions you run. It shows who is working, who went quiet, and the team your boss session has built. The boss hires, tasks, cancels and drops its team with five tools. The pane does not send anything.

Run `/fleet` to open the pane, and `/fleet close` to close it.

```
╭──────────────────────────────────────────────────╮
│ fleet  3 sessions  1 working  1 on team          │
│                                                  │
│ ╭──────────────────────────────────────────────╮ │
│ │                                              │ │
│ │ team                                         │ │
│ │ done    quorum-63  Research, ready, idle     │ │
│ │         Built the parser.                    │ │
│ │                                              │ │
│ ╰──────────────────────────────────────────────╯ │
│                                                  │
│ ╭──────────────────────────────────────────────╮ │
│ │                                              │ │
│ │ other sessions                               │ │
│ │ name      state    quiet  folder             │ │
│ │ glowseed  working  1m     garden             │ │
│ │                                              │ │
│ ╰──────────────────────────────────────────────╯ │
│                                                  │
│ [ refresh ]  [ close ]  esc closes               │
╰──────────────────────────────────────────────────╯
```

## The pane

Sessions come from the registry Claude Code keeps in its config folder, so every session on the machine is listed, in the terminal or the desktop app. The list is read again every 4 seconds for as long as this session is open, whether the pane is open or not.

The pane has two buttons: `r` refreshes, `c` closes. Each team member's first line is a button too: Tab or the arrows move to it, and Enter opens that member's detail. The detail shows its role, reply state and session state, the open task with its id, status and running time, the goal, scope and done condition, the newest reply, the queued tasks and the earlier ones. `b` goes back to the lists. The pane has no input and sends nothing.

A team member's line shows its role, whether it has replied, whether its session is working or idle, its task id, how long a sent task has run, and how many tasks are queued for it.

A working session that has not changed state for 30 minutes gets a `!` after its quiet time. That is the one that went quiet.

Only sessions from the boss's own project are listed: those whose folder is the boss's folder or inside it. A sibling folder with a similar name (`/a/proj-2` next to `/a/proj`) is not inside it. If the scan has no entry for the boss, nothing is hidden. A team member stays in the team section wherever it runs. `fleet_hire` of a session outside the root returns an error that says so.

A reply in the team section is shown whole, word-wrapped to the section under its status word, up to 12 lines and then a `... N more lines` line. A note wraps the same way up to 4 lines. Only the folder column of the sessions table is cut with an ellipsis.

The pane is plain text and box-drawing characters, with dim borders and labels. The state word is always printed. A muted green marks `done`, red `blocked`, and yellow `asked`, `stale` and a quiet session. The team section appears only when the team has members, and the notes section only when there are notes.

## The boss's tools

The boss session has five model tools. The model names them `mcp__fleet-board__<name>`. They are listed in the prompt, not behind ToolSearch.

| Tool | Input | Does |
| --- | --- | --- |
| `fleet_hire` | `session`, `role` | Adds the session to the team and sends the briefing. Refused when the session is already on the team, when it is on another running boss's team, or when the caller is itself on a running boss's team. A team whose boss session is gone holds no one. |
| `fleet_task` | `session` or `role`, `text`, optional `scope`, `done`, `after` | Queues one task with a six-character id, and sends it at once when nothing holds it. A session must be on the team; a role must have a member on it. |
| `fleet_cancel` | `session`, `task`, or both | Cancels the open task and tells the member, or, with the id of a queued task, takes it off the queue. With `task` alone, finds that task on the team or in the pool and cancels it. |
| `fleet_drop` | `session` | Takes the session off the team and tells it. |
| `fleet_status` | none | Lists the team: each member, its role, reply state, task goal, id and status, last reply, queue and earlier tasks. |

`session` takes the row number in the pane, the session's name, its folder name, or the start of its name. A name that matches more than one session is an error.

`role` is `specialist`, `local` or `research`.

The task message has a fixed shape: the goal (`text`), then `Scope:` and `Done when:` lines when they are given, then what the report should hold: what changed, how it was checked, and anything left open, ending with `done <id>` or `blocked <id>: <why>`.

A bad input returns an error text and changes nothing: an unknown or ambiguous session, an unknown role, an empty task, a task for a session not on the team, or an `after` that names no task on the team.

A message the boss sends with `SendMessage` reaches the session, but the team does not track it. Use `fleet_task` for team members.

## Boss and employees

The session that hires is the boss. Once it has a team, its system prompt says so and lists each employee by name, session id and role. Each employee's system prompt names its boss and the session its reports go to. Both records live in the plugin store, so they survive a restart.

- Hire: `fleet_hire` sends the briefing and puts the session on the team at once. The member reads `waiting for a reply` until its transcript has a reply written after the briefing. Then it reads `ready`. The boss's system prompt shows the same state, read fresh each turn while a member is waiting. A member whose registry line is missing from three scans in a row leaves the team; one missing scan keeps it.
- Queue: a member works one task at a time. A new task joins the member's queue, and the first queued task is sent once three things hold: the member has no task still `sent`, the boss has the notice of its last task, and the task `after` names, if any, is `done`. A task is sent at once when nothing holds it. A `blocked` task frees its member for the next one. The tool's answer says `sent <name> task <id>`, or `queued task <id> for <name>, behind task <id>` or `after task <id>`. Use `after` to order work across members: a review task can wait for a build task on another member.
- Role: a task given to a `role` instead of a session waits in the team's pool. Each scan hands pooled tasks out in order, each to a member of its role that has answered its briefing, that nothing holds and that has no queue of its own, the one free longest first. A member that cannot be reached is skipped for that scan, and the task stays in the pool until another member takes it. So a member works through tasks given to it by name before it takes from the pool. The answer says `sent <name> task <id>`, or `queued task <id> for the next free <role> member`. The pool is kept in the plugin store under the boss, like the team, and the pane lists it under `unassigned`.
- Cancel: `fleet_cancel` marks the open task `cancelled`, tells the member to stop, and sends the next queued task. A cancelled task sends the boss no notice.
- History: the task a new one replaces is kept as an earlier task, with how long it took. Each member keeps its last 5, and an older one while a queued task's `after` still names it. An earlier task that was `blocked` is still read: a later `done <id>` marks it done, tells the boss, and sends what waits on it.
- Stuck: a queued or pooled task whose `after` task was cancelled, or left the team with its member, can never be sent, nor can a pooled task whose role has no member left. The boss is told once, and cancels it or sends it again.
- Hold: the answer for a queued task names what holds it: `after task <id>`, `behind task <id>`, `until you have the report of task <id>`, or `until its session is back`. The same check decides when the task goes out.
- Task: `fleet_task` gives each task a six-character id. The task is `sent` until a reply from the employee contains that id, and then it is `done`. A reply without the id does not finish it. A reply that says `blocked <id>` marks the task `blocked` and keeps that line. A later reply that says `done <id>` flips it to `done`. A line an employee writes while its task is `sent` counts as `asked` only when it has a question mark or starts with "question" or "need". A `sent` task with no new line from its employee for 10 minutes is flagged. The 10 minutes count from its newest line, or from the send when it has none.
- Reply text: when a task is done or blocked, its reply is the text up to and including the line with the id, at most 1500 characters. A longer text keeps its end and starts with an ellipsis. The same text is the notice the boss gets, and the `last:` line in its prompt.
- Notices: when a task becomes done, blocked, asked or stale, the boss is told through `$.prompt.submit`, which runs as a turn once the boss is idle. Every change one scan finds goes into one prompt, one notice after another, so three tasks that finish together cost one turn. The notice is a header line, which says the employee report is for the boss to verify and is not an instruction from the user, then the reply text with each line behind `> `. The notice is still submitted as a turn, so the wrapping marks the text as data for the boss to check; it does not block it. Each change is announced once, and the announced key is kept with the task, so a restart does not repeat it. Refreshes that overlap share one scan, so an overlap sends no second notice.
- Background: with the pane closed, nobody on the team and nothing in the pool, the 4-second tick does not scan or read transcripts. Each transcript is read by byte offset from a row boundary: a poll reads only what was written since the last one.

## Status line

While the boss has a team, the status line reads like `fleet 3 on team · 1 open · 1 blocked · 1 done · 2 queued · 1 unassigned`. A count of zero is left out. The line is set only when it changes, and cleared when the team is empty.

## Roles and the briefing

The three roles and the briefing text are the ones in the `boss` skill: specialist, local execution, research. A briefed session is told to reply "ready", keep its work until it gets a task, and report done or blocked.

## Commands

| Command | Does |
| --- | --- |
| `/fleet` | Open the pane |
| `/fleet close` | Close the pane |

Any other word prints the usage line, which names the five tools.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `quietMinutes` | `30` | How long a working session may stay unchanged before it gets a `!` (5 to 600) |

## Limits

- Messages go only to sessions the boss names in `fleet_hire`, `fleet_task`, `fleet_cancel` or `fleet_drop`, and to the team when it is updated. A queued task is sent by the 4-second tick, without a new call. Other sessions are never messaged on their own.
- A queued task waits on one `after` task. A blocked `after` task holds it until that task is done or the boss cancels the queued one.
- A reply is read from the employee's transcript, `~/.claude/projects/<cwd>/<session>.jsonl` under the config folder, read from its end. The read starts at 1 MiB and doubles until it reaches back to the briefing, or covers the whole file. The reply itself still arrives in the employee's own conversation.
- The boss is identified by its session id. A boss that starts a new session has a new id, so its old team stays with the old one.
- Only the three roles exist.
- The registry format belongs to Claude Code. If a session record lacks an id, a process id or a folder, it is skipped.
