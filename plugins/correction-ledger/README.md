# correction-ledger

Say a correction once. Claude keeps it.

When you push back on Claude ("I said no semicolons"), the ledger saves the point as a short rule. Every later turn in that project carries the rules in the system prompt. If Claude breaks a rule and you say it again, the rule gets a strike and is sent louder.

## Strikes

A reminder that does not work is a fact worth recording. Each time you repeat a saved rule, it is marked `[broken N×]`:

```
- [broken 2×] Never use semicolons in the TypeScript files in this project.
```

Broken rules are listed first, and the prompt tells Claude to check its work against them before answering. At three strikes, `/rules` says a reminder is not holding the rule and suggests moving it to `CLAUDE.md` or a hook. Strikes also decide what is kept when the ledger is full: the rule broken least often goes first.

## How it works

1. A cheap filter looks at each prompt you type. Only short prompts with pushback wording ("no", "again", "I said", "instead", "shouldn't") go further.
2. One model call (Haiku by default) sees the saved rules, Claude's last answer and your message. It answers: not a correction, a new rule, a repeat of rule N, or a change to rule N.
3. A rule has to share a word with what you wrote, so the model cannot invent one.
4. The check runs after your prompt is sent. It never delays a turn, and any failure leaves the ledger as it was.
5. A toast tells you what changed: `saved rule #1: … (/rules rm 1 to undo)`.

Only prompts you type are judged. Scheduled runs and notifications are not.

## Projects and sessions

Rules belong to the project: the root of the git repository the session runs in (for a worktree, the main working tree's root). A session started in a subfolder uses the same rules as one started at the root. Outside git, the folder Claude Code was started in is the project. Another project starts empty.

All sessions in a project share one ledger file. The file is read on every turn, so a rule saved in one session reaches the others on their next prompt, with no restart. A write replaces the file only if it still holds what the writer read; otherwise the writer reads again and redoes its change. Two sessions saving at the same moment keep both rules.

## Commands

| Command | Does |
| --- | --- |
| `/rules` | List the rules for this project, with what you said and when |
| `/rules add <rule>` | Save a rule by hand |
| `/rules rm <number>` | Remove a rule |
| `/rules clear` | Remove all rules in this project |
| `/rules off` / `/rules on` | Pause or resume saving and sending, for every project |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | `haiku` | Model that judges prompts |
| `maxRules` | `12` | Rules kept per project (3 to 30) |
| `timeoutSeconds` | `15` | Wait for the model before dropping a check (5 to 60) |

## Limits

- Rules apply to one project only. For a rule that holds everywhere, use your global `CLAUDE.md`.
- Rules live in `~/.claude/plugins/correction-ledger/` (or under `$CLAUDE_CONFIG_DIR`), not in the project, so they are not shared with a team.
- `/rules off` pauses the ledger for every project and every session.
- The filter misses corrections with no pushback wording ("use tabs here"). `/rules add` covers those.
- Each possible correction costs one small model call.
