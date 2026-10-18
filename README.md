# vii-mods

Mods that make Claude Code remember more, waste less and sound better.

| Mod | What it does |
|---|---|
| [**rescribe**](#rescribe) | A shortcut rewrites the draft in your prompt box into a sharper prompt. Your original stays one key away. |
| [**gpu-lock**](#gpu-lock) | One GPU job at a time. A second one is refused before it can crash the first. |
| [**correction-ledger**](#correction-ledger) | Correct Claude once and it keeps the rule. Break it, and the rule moves to the top. |
| [**fleet-board**](#fleet-board) | A pane for your other Claude sessions: who is working, who went quiet, who is on the team. |
| [**lookback**](#lookback) | Search every past session by words and by meaning, on your own machine. |
| [**smart-comments**](#smart-comments) | Keeps the comments that tell a reader something, and has Claude cut the rest. |
| [**cues**](#cues) | Mechanical key sounds as you type, and a chime when a reply lands. For Linux. |

## Install

In Claude Code, add the marketplace once:

```
/plugin marketplace add CoderDayton/vii-mods
```

Install whichever mods you want:

```
/plugin install rescribe@vii-mods
/plugin install gpu-lock@vii-mods
/plugin install correction-ledger@vii-mods
/plugin install fleet-board@vii-mods
/plugin install lookback@vii-mods
/plugin install smart-comments@vii-mods
/plugin install cues@vii-mods
```

Each mod works alone. They need a Claude Code build with mods turned on; what else a mod needs is listed in its section. What changed in each mod, newest first, is in the [changelog](CHANGELOG.md).

---

## rescribe

Type a rough draft, press a shortcut, and the draft in the prompt box becomes a clearer prompt. Nothing is sent until you press Enter.

- **Your original is kept.** It goes into the Up-arrow history, so Up brings it back and Down returns to the new text.
- **Attachments stay.** Pasted images and `@file` mentions are left where they are.
- **Review first, if you like.** With `autoAccept` off, a diff opens with Apply and Dismiss buttons before anything changes.
- **One step to set up:** bind a key chord in `~/.claude/keybindings.json`. The mod's README has the lines to paste.

[Full README](plugins/rescribe/README.md)

---

## gpu-lock

Two training runs on one card end with both out of memory. This mod spots a Bash command that uses the GPU, checks free memory, and runs it under a lock.

- **Exclusive mode** (the default): one GPU job at a time. A second is refused with a message that says who holds the card and for how long.
- **Shared mode:** several jobs run together while their memory stays under a limit, 75% of the card by default.
- **Markers:** end a command with `# gpu 8g` to say how much memory it needs, or `# nogpu` to say it uses none.
- `/gpu status` shows running jobs and who is waiting · `/gpu check <command>` says if a command counts as a GPU job · `/gpu off` / `on`.

Needs an NVIDIA GPU with `nvidia-smi`, and `flock`.

[Full README](plugins/gpu-lock/README.md)

---

## correction-ledger

Say a correction once and Claude keeps it. The mod saves each one as a standing rule and feeds the rules back on every turn, so you stop repeating yourself.

- **Corrections, not requests.** "Show me the result before a long bake" is saved. "The maze needs rounded corners" is work for now, and is not.
- **Strikes.** Each time you have to repeat a rule it is marked broken, listed first, and kept longer.
- **Rules run out.** One you stop needing fades after some days of work. `/rules keep` holds one for good.
- **Per project.** Every session in a repository shares the same rules.
- `/rules` lists them · `/rules add <rule>` · `/rules rm <number>` · `/rules keep <number>` · `/rules clear` · `/rules off` / `on`.

[Full README](plugins/correction-ledger/README.md)

---

## fleet-board

When you run several Claude sessions at once, this pane shows them all: who is working, who went quiet, and which ones your lead session has put on its team.

- **The pane only watches.** It sends nothing to any session.
- **A boss session runs the team** with four tools: hire a session for a role, send it a task, read the team's status, and drop a member.
- **Tasks are tracked.** Each one has a short id, and it is marked done when the reply carries that id.
- `/fleet` opens the pane · `/fleet close` closes it.

[Full README](plugins/fleet-board/README.md)

---

## lookback

"Didn't we fix this already?" This mod searches all your past Claude Code sessions, by exact words and by meaning, and shows each hit inside the turn it came from.

- **Local.** Transcripts stay on disk, vectors come from your own Ollama, and the index is one SQLite file.
- **It records more than chat:** commands, file edits, sub-agent runs and the MCP tools you name.
- **Screenshots, if you want them:** set a local vision model and the images you paste are captioned and searchable, each with the path to open it. Off by default.
- **Three ways in:** a tool Claude can call, the `/lookback` command, and recall shown beside prompts that ask about earlier work.
- `/lookback <question>` · `/lookback fix <error>` · `/lookback how <words>` · `/lookback blame <file>` · `/lookback show <id>` · `/lookback forget <id>`.

Needs [Bun](https://bun.sh) 1.4.0 or newer, and [Ollama](https://ollama.com) with `nomic-embed-text` for search by meaning. Without Ollama it still searches by words.

[Full README](plugins/lookback/README.md)

---

## smart-comments

Claude writes more comments than a reader needs. This mod reads each comment Claude adds and judges it by one test: does it tell the reader something the code cannot?

- **Kept:** a measured figure, a pitfall, a rule that must hold, a reason.
- **Cut:** a comment that repeats the line under it, or tells the story of the edit.
- **Docstrings are left alone.**
- **No model call.** Every test is text matching, so it costs nothing and adds no wait.
- **No commands.** After an edit, Claude is told which lines to take out, and does it.

[Full README](plugins/smart-comments/README.md)

---

## cues

Sound for Claude Code. Your typing clicks on a mechanical switch, a chime plays when you send a prompt, a bell when the reply lands, and a low tone when a turn fails.

- **13 recorded switches:** Cherry MX Blue, Brown and Black, Holy Panda, Topre, NovelKeys Cream, Alpaca, Turquoise Tealios, Gateron Black Ink and Red Ink, Blue Alps, Box Navy and Buckling Spring.
- **Claude can type too.** `/cues claude on` clicks out its replies at a typist's pace, on a switch of its own if you like: `/cues claude topre`.
- **Every sound has its own switch.** `/cues keys off`, `/cues reply off` and the rest, and one volume for keys and one for chimes.
- **Evenly loud.** Each clip is leveled as it loads, so no switch or chime jumps out.
- `/cues` shows the state · `/cues <switch>` · `/cues volume keys 40` · `/cues volume chimes 70` · `/cues reply bell` / `notes` · `/cues off` / `on`.

List cues first in `enabledPlugins` in `~/.claude/settings.json`. Plugins run in that order, so a plugin listed before cues that does work on a sent prompt, such as lookback's recall, holds back the send chime until it is done.

```json
"enabledPlugins": {
  "cues@vii-mods": true,
  "lookback@vii-mods": true
}
```

Needs Linux with PipeWire or ALSA, and [Bun](https://bun.sh). Key recordings are from [kbsim](https://github.com/tplai/kbsim) by Thomas Lai (MIT), see [`sounds/keys/LICENSE`](plugins/cues/sounds/keys/LICENSE).

[Full README](plugins/cues/README.md)

## License

[MIT](LICENSE)
