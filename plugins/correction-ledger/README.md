# correction-ledger

Say a correction once. Claude keeps it.

When you push back on Claude ("I said no semicolons"), the ledger saves the point as a short rule. Every later turn in that project carries the rules in the system prompt. If Claude breaks a rule and you say it again, the rule gets a strike and is sent louder. A rule you never repeat runs out and is removed, so the list cleans itself.

## Strikes

A reminder that does not work is a fact worth recording. Each time you repeat a saved rule, it is marked `[broken N×]`:

```
- [broken 2×] Never use semicolons in the TypeScript files in this project.
```

Broken rules are listed first, and the prompt tells Claude to check its work against them before answering. At three strikes, `/rules` says a reminder is not holding the rule and suggests moving it to `CLAUDE.md` or a hook. Strikes also decide what is kept when the ledger is full: the rule broken least often goes first.

## What is saved, and for how long

The model sorts each correction into one of three kinds:

| Kind | Example | Saved |
| --- | --- | --- |
| Work | "No, I want a real unlock sound", "the maze needs rounded corners" | Not saved. It is a request for what to build, and Claude acts on it now. |
| Task rule | "Stop the run after the first epoch" | For 2 worked days |
| Project rule | "Show me the result before a long bake" | For 14 worked days |

A worked day is a calendar day (UTC) on which you sent a prompt in the project. Days away do not count, so a project left for a month comes back with its rules.

A rule's life starts again each time you repeat it, and each strike makes it longer: a project rule broken once lasts 28 worked days, broken twice 42. A rule that runs out is removed on your next prompt, and a toast names it.

Two kinds of rule never run out: one you add with `/rules add`, and one you mark with `/rules keep <number>`. `/rules` shows what each rule has left. When the ledger is full, kept rules are the last to go.

When the model is unsure between a task rule and a project rule, it picks the task rule. A rule saved from before lives were added counts as a project rule.

## Rules that fire on a call

Some rules are about one action: "never commit without asking". Sending such a rule every turn wastes prompt space, and Claude can still miss it. The ledger gives it a trigger instead: a tool and a few whole words, such as `Bash: git commit`. The rule is then left out of the system prompt and sent when Claude makes a matching call.

- **Never broken:** the call runs, and Claude reads the rule right after it, once a turn.
- **Broken before** (one strike or more): the call is stopped once, with the rule as the reason. If Claude makes the same call again, in that turn or after your next prompt, it runs. This gives Claude one forced look at the rule before it acts.

The model that judges your correction names the trigger. It sees the calls Claude made since your last prompt, and a trigger is taken only when one of those calls matches it, so it cannot invent one. A trigger is plain words, never a pattern: every word must be in the call, as a whole word. Rules about style or facts ("no semicolons") get no trigger and are sent every turn.

A rule that fires counts as used that day, so a rule in use does not run out. The save toast and `/rules` show the trigger. `/rules rm <number>` removes the rule and its trigger. When you reword a rule, it takes the trigger of the new wording, or none.

## How it works

1. A cheap filter looks at each prompt you type. Only short prompts with pushback wording ("no", "again", "I said", "instead", "shouldn't") go further.
2. One model call (Haiku by default) sees the saved rules, Claude's last answer, the calls Claude just made and your message. It answers: not a correction, a new task rule, a new project rule, a repeat of rule N, or a change to rule N.
3. A rule has to share a word with what you wrote, so the model cannot invent one.
4. The check runs after your prompt is sent. It never delays a turn, and any failure leaves the ledger as it was.
5. A toast tells you what changed: `saved rule #1: … (/rules rm 1 to undo)`.

Only prompts you type are judged, and only they count a worked day. Scheduled runs and notifications do neither.

## Projects and sessions

Rules belong to the project: the root of the git repository the session runs in (for a worktree, the main working tree's root). A session started in a subfolder uses the same rules as one started at the root. Outside git, the folder Claude Code was started in is the project. Another project starts empty.

All sessions in a project share one ledger file. The file is read on every turn, so a rule saved in one session reaches the others on their next prompt, with no restart. A write replaces the file only if it still holds what the writer read; otherwise the writer reads again and redoes its change. Two sessions saving at the same moment keep both rules.

## Commands

| Command | Does |
| --- | --- |
| `/rules` | List the rules for this project, with what you said, when, and how long each has left |
| `/rules add <rule>` | Save a rule by hand. It is kept until you remove it |
| `/rules keep <number>` | Keep a rule until you remove it |
| `/rules rm <number>` | Remove a rule |
| `/rules clear` | Remove all rules in this project |
| `/rules off` / `/rules on` | Pause or resume saving and sending, for every project |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | `haiku` | Model that judges prompts |
| `maxRules` | `12` | Rules kept per project (3 to 30) |
| `timeoutSeconds` | `15` | Wait for the model before dropping a check (5 to 60) |
| `taskDays` | `2` | Worked days a task rule lasts (1 to 14) |
| `ruleDays` | `14` | Worked days a project rule lasts (3 to 90) |

## Limits

- Rules apply to one project only. For a rule that holds everywhere, use your global `CLAUDE.md`.
- Rules live in `~/.claude/plugins/correction-ledger/` (or under `$CLAUDE_CONFIG_DIR`), not in the project, so they are not shared with a team.
- `/rules off` pauses the ledger for every project and every session.
- The filter misses corrections with no pushback wording ("use tabs here"). `/rules add` covers those.
- Each possible correction costs one small model call.
- A rule that runs out is gone. Say it again, or use `/rules add`, to bring it back.
- A trigger can be too wide or too narrow. A wide one reminds or stops Claude on calls the rule is not about; a narrow one misses the same action done another way (`git commit` does not match a commit made through another tool). A rule added with `/rules add` has no trigger.
- A rule with a trigger is not in the system prompt, so Claude does not know it while planning, only when it acts.
