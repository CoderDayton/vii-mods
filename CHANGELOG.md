# Changelog

All notable changes to the vii-mods marketplace are listed here, newest first, each marked with the mod it belongs to. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The mods are not versioned yet (each is 0.1.0), so changes are grouped by the date they reached GitHub. Changes not yet there are listed under Unreleased.

## Unreleased

### Added

- **fleet-board:** give `fleet_task` a `role` in place of a session. The task waits in a team-wide pool and goes to the member of that role that has been free longest, after the tasks given to that member by name. A pooled task goes only to a member that has answered its briefing, and skips a member it cannot reach
- **fleet-board:** let `fleet_cancel` take a task id alone and find the task wherever it is: open, queued or in the pool
- **fleet-board:** say what holds a queued task in the `fleet_task` answer: an `after` task, a task ahead of it, a report the boss has not had yet, or a session that is gone
- **fleet-board:** queue tasks per member: a task for a busy member waits and is sent when the member is free, and `after` holds a task until another member's task is done
- **fleet-board:** add `fleet_cancel`, which cancels a member's open task and tells it, or takes a queued task off the queue
- **fleet-board:** give `fleet_task` optional `scope` and `done` fields. The task message states the goal, scope, done condition and the report it wants
- **fleet-board:** keep each member's last 5 earlier tasks with how long each took, listed by `fleet_status`. A blocked earlier task is still read, so a later done frees what waits on it
- **fleet-board:** tell the boss once when a queued task can never be sent because its `after` task was cancelled or left the team
- **fleet-board:** open a team member's detail from its line in the pane: its brief, reply, queue and earlier tasks
- **fleet-board:** show the team's open, blocked, done and queued counts in the status line

### Changed

- **fleet-board:** send the boss every change one scan finds as one prompt, not one prompt per task
- **fleet-board:** show each member's session state, task run time and queue length on its line in the pane

### Fixed

- **fleet-board:** keep both changes when two team updates land at once, such as a task call during the background scan

## 2026-10-22

### Added

- **lookback:** caption a pasted image in the background when its prompt's turn starts, instead of at the next session start. The caption server stays up 60 s after the last caption and is shared by runs, so back-to-back image prompts load the model once ([`2e2065b`])

### Changed

- **lookback:** the caption prompt asks for a short description plus all visible text, and names no game, app or brand that is not written in the image ([`2e2065b`])
- **lookback:** remove a stray `</think>` tag from a caption and keep the text on both sides of it ([`2e2065b`])

## 2026-10-17

### Added

- **lookback:** caption pasted images with a local vision model, off by default: set `captionServer` to a llama-server command, or `captionModel` and `captionUrl` for a server already running. Captions are searched as the `image` kind; the saved path is shown but not searched ([`9c1cc31`])
- **lookback:** skip an image the model turns down in 3 runs. A caption server that cannot be reached stops the run and costs no image a try ([`55e40f3`])
- **lookback:** stop a caption server that lookback started when lookback ends, even when it is killed outright, on Linux ([`9c1cc31`])
- **lookback:** add `lookback index --wait`, which waits up to 60 s for an index run already going; `/lookback index` uses it ([`9c1cc31`])
- **lookback:** check the caption setup and the model files named in `captionServer` with `lookback doctor` ([`9c1cc31`])
- **lookback:** index calls to tools other than Bash and file edits, successful tool results, and compaction summaries, as the `call`, `result` and `summary` kinds. They are searched apart from prose so they do not crowd it out ([`a76c7be`])
- **lookback:** match a tool call left open at the end of a run with its result on the next run ([`a76c7be`])
- **smart-comments:** add the `noComments` option, which flags every comment Claude adds ([`b85e857`])

### Changed

- **correction-ledger:** leave one-off corrections out of the rules ([`b00b932`])
- **lookback:** speed up every lookup the hooks make: recall 134 → 97 ms, search 514 → 252 ms, the session-start digest 191 → 26 ms, and an index run with nothing new 387 → 69 ms ([`9c1cc31`])
- **lookback:** migrate the index to schema 14 on the first index run. Until that run, searches report that there is no index ([`9c1cc31`])
- **lookback:** print what `/lookback index` did, or that the index is up to date, and show the notices it used to drop ([`9c1cc31`])
- **lookback:** show a toast when image captions stop during a background index run ([`9c1cc31`])
- **lookback:** embed new entries before captioning images, so a long batch of captions cannot hold up vectors ([`55e40f3`])
- **lookback:** show an image's caption before its file name in `fix` output and session reads ([`55e40f3`])
- **lookback:** store vectors as INT8, a quarter of the size of float32. Schema 10 converts an existing index in place ([`a76c7be`])
- **lookback:** settle most searches with a first pass over the 2,000 nearest passages, and search small kind groups again with a prefilter ([`a76c7be`])

## 2026-10-13

_First release of the marketplace._

### Added

- **lookback:** show past work beside a prompt that asks about earlier work, newest first ([`9d8e735`])
- **lookback:** read time words in a query, such as `yesterday`, `last week`, `since friday` and `sept 21` ([`9d8e735`])
- **lookback:** search the current session, keep file notes per folder, and search a named folder ([`9d8e735`])
- **cues:** add the mod: key sounds from 13 recorded switches as you type, a chime when you send a prompt, a bell when the reply lands, and a low tone when a turn fails, on Linux ([`ee9bcda`])
- **lookback:** add the mod: search past Claude Code sessions by words and by meaning, with a SQLite index (FTS5 and sqlite-vector) and embeddings from Ollama, through a search tool, the `/lookback` command and recall beside prompts ([`e18467a`])
- **lookback:** index thinking, shell commands, file edits and sub-agent runs, with the file tools named by `fileTools` ([`7169616`])
- **lookback:** add the `show`, `forget`, `fix`, `how`, `blame` and `files` commands, paging, and secret redaction ([`7169616`])
- **lookback:** show each hit inside its turn: the prompt that opened it, how it ended, and the reply that came next ([`7169616`])
- **lookback:** fuse word and meaning scores with a balance set per query, and drop weak sessions ([`7169616`])
- **smart-comments:** add the mod: sort each comment Claude adds into keep, plain, noise or docstring, and name the lines to cut in a note sent with the edit ([`c25ccac`])
- **smart-comments:** send one follow-up when a turn ends with a file that still fails, for file tools and shell edits alike ([`c25ccac`])
- **correction-ledger:** save each rule as a task rule or a project rule, and let it run out after a set number of worked days unless it is repeated, fired or kept ([`81674b9`])
- **correction-ledger:** send a rule about one action when a matching tool call is made. A rule that gets broken stops the call once ([`81674b9`])
- **fleet-board:** add the mod: list running sessions in a pane, and open a new session in a terminal window, tmux or WezTerm ([`959ca76`], [`0f8a7c0`])
- **fleet-board:** let a boss session run a team with tools to hire, task, check and drop members ([`9218572`])
- **fleet-board:** give each task a short id, and mark it done or blocked when a reply carries that id ([`9218572`])
- **fleet-board:** mark a member ready once its transcript shows a reply after the briefing, and wake the boss when replies arrive ([`0f8a7c0`], [`9218572`])
- **fleet-board:** keep the team in the plugin store, and tell each session in its prompt whether it is a boss or an employee ([`0f8a7c0`])
- **correction-ledger:** add the mod: turn a correction into a standing rule for the project, with a model check. A repeat adds a strike, and struck rules are sent first and louder ([`4c66d01`])
- **gpu-lock:** add shared mode: several GPU jobs run together while their memory stays under a limit ([`ae1d086`])
- **gpu-lock:** queue waiting jobs first in, first out ([`ae1d086`])
- **gpu-lock:** chart memory per card in the pane, from one history file that every session reads, stacked per job ([`ae1d086`])
- **rescribe:** keep the original draft in the Up-arrow history, so Up brings it back ([`3d8235f`])
- **rescribe:** add the mod: rewrite the draft in the prompt box with a shortcut and one model call, Haiku on high effort by default ([`02b102b`], [`c27c32f`])
- **rescribe:** review the rewrite as a diff in a docked or inline pane, with Apply and Dismiss ([`c27c32f`])
- **rescribe:** add the `autoAccept` option ([`c27c32f`])
- **rescribe:** refuse a rewrite that grew past 2.5 times the draft or shares under 30% of its words, and name the reason in a toast ([`c27c32f`])
- **gpu-lock:** add the mod: run GPU commands one at a time under a `flock` lock, after checking free GPU memory ([`d93ff7d`])
- **gpu-lock:** close the `/gpu` pane with its Close button, with `/gpu` again, with `/gpu close`, or with Escape ([`d4b33d1`])
- **dictation-repair:** add the mod, renamed prompt-repair the same day: one Haiku prompt fixes misheard words, wrong words and self-corrections, with glossary hits added, and a menu above the prompt sends, edits or skips the fix ([`24cca8f`], [`fe68b77`])

### Changed

- **lookback:** keep a long query's rarest words, and require two fifths of them in a keyword match ([`38ecb99`])
- **smart-comments:** keep comments that state a contract, a consequence or a unit ([`dd3cec9`])
- **smart-comments:** shorten the note sent after an edit ([`3b17e8a`])
- **fleet-board:** restyle the pane, wrap replies, and show only this project's sessions ([`a96cc74`])
- **fleet-board (breaking):** make the pane read-only. The boss session runs the team through its tools ([`9218572`])
- **rescribe (breaking):** turn `autoAccept` on by default. The rewrite applies at once, and the review menu is opt-in ([`3d8235f`])
- **gpu-lock:** redesign the band and the pane ([`ae1d086`])
- **rescribe:** edit every sentence of the draft, and turn polite requests into instructions ([`7071a21`])
- **rescribe:** hide the button row when there is nothing to review ([`d8c8d16`])

### Removed

- **prompt-repair (breaking):** remove the mod; rescribe replaces it ([`02b102b`])
- **gpu-lock (breaking):** remove the pane argument of `/gpu` ([`d4b33d1`])

### Fixed

- **correction-ledger:** share one ledger file across sessions. A write retries when another session wrote first ([`74db581`])
- **correction-ledger:** key rules by the git repository root, so a session started in a subfolder or a worktree shares its project's rules ([`d8b517c`])
- **gpu-lock:** draw the band under the bands of other plugins instead of replacing them ([`5bdc057`])
- **gpu-lock:** clip long GPU process names, and run `/gpu` at once ([`5d3927e`])

[`2e2065b`]: https://github.com/CoderDayton/vii-mods/commit/2e2065b
[`55e40f3`]: https://github.com/CoderDayton/vii-mods/commit/55e40f3
[`9c1cc31`]: https://github.com/CoderDayton/vii-mods/commit/9c1cc31
[`a76c7be`]: https://github.com/CoderDayton/vii-mods/commit/a76c7be
[`b85e857`]: https://github.com/CoderDayton/vii-mods/commit/b85e857
[`b00b932`]: https://github.com/CoderDayton/vii-mods/commit/b00b932
[`38ecb99`]: https://github.com/CoderDayton/vii-mods/commit/38ecb99
[`9d8e735`]: https://github.com/CoderDayton/vii-mods/commit/9d8e735
[`ee9bcda`]: https://github.com/CoderDayton/vii-mods/commit/ee9bcda
[`7169616`]: https://github.com/CoderDayton/vii-mods/commit/7169616
[`3b17e8a`]: https://github.com/CoderDayton/vii-mods/commit/3b17e8a
[`e18467a`]: https://github.com/CoderDayton/vii-mods/commit/e18467a
[`dd3cec9`]: https://github.com/CoderDayton/vii-mods/commit/dd3cec9
[`c25ccac`]: https://github.com/CoderDayton/vii-mods/commit/c25ccac
[`81674b9`]: https://github.com/CoderDayton/vii-mods/commit/81674b9
[`a96cc74`]: https://github.com/CoderDayton/vii-mods/commit/a96cc74
[`9218572`]: https://github.com/CoderDayton/vii-mods/commit/9218572
[`0f8a7c0`]: https://github.com/CoderDayton/vii-mods/commit/0f8a7c0
[`959ca76`]: https://github.com/CoderDayton/vii-mods/commit/959ca76
[`d8b517c`]: https://github.com/CoderDayton/vii-mods/commit/d8b517c
[`3d8235f`]: https://github.com/CoderDayton/vii-mods/commit/3d8235f
[`7071a21`]: https://github.com/CoderDayton/vii-mods/commit/7071a21
[`74db581`]: https://github.com/CoderDayton/vii-mods/commit/74db581
[`d8c8d16`]: https://github.com/CoderDayton/vii-mods/commit/d8c8d16
[`ae1d086`]: https://github.com/CoderDayton/vii-mods/commit/ae1d086
[`4c66d01`]: https://github.com/CoderDayton/vii-mods/commit/4c66d01
[`c27c32f`]: https://github.com/CoderDayton/vii-mods/commit/c27c32f
[`02b102b`]: https://github.com/CoderDayton/vii-mods/commit/02b102b
[`5bdc057`]: https://github.com/CoderDayton/vii-mods/commit/5bdc057
[`fe68b77`]: https://github.com/CoderDayton/vii-mods/commit/fe68b77
[`d4b33d1`]: https://github.com/CoderDayton/vii-mods/commit/d4b33d1
[`5d3927e`]: https://github.com/CoderDayton/vii-mods/commit/5d3927e
[`d93ff7d`]: https://github.com/CoderDayton/vii-mods/commit/d93ff7d
[`24cca8f`]: https://github.com/CoderDayton/vii-mods/commit/24cca8f
