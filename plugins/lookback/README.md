# lookback

Search your past Claude Code sessions by words and by meaning. It runs on your machine: transcripts stay on disk, vectors come from a local Ollama, and the index is one SQLite file.

Claude gets a `search` tool and you get `/lookback`. When you ask "didn't we fix this before?", the best matches ride along with your prompt.

## Requirements

- [Bun](https://bun.sh) 1.4.0 or newer. The mod installs its packages on first start. SQLite ships inside Bun, so its version moves with Bun's; `lookback doctor` prints both and warns about a Bun that is too old.
- On macOS, also `brew install sqlite`. Apple's SQLite, which Bun uses there, cannot load extensions, so the mod uses Homebrew's. `LOOKBACK_SQLITE_LIB` names another `libsqlite3.dylib`. The SQLite version on macOS is then Homebrew's.
- [Ollama](https://ollama.com) with an embedding model: `ollama pull nomic-embed-text`.

Without Ollama, search still works on words. `lookback doctor` says which part is down.

## Use

| You | What happens |
| --- | --- |
| Start a session | The index updates in the background. Only new transcript lines are read. |
| Ask about earlier work | When `autoRecall` is on, up to 3 matching sessions are added beside the prompt as `<lookback-recall>` data. |
| A shell command fails | When `errorHints` is on, Claude gets what past sessions ran after the same error, as `<lookback-fix>` data with the result. Each error is looked up once per session. |
| `/lookback <question>` | Prints the matching sessions, each match inside its turn. A last line names the offset of the next page. |
| `/lookback show <id> [offset]` | Reads one session in order. The first 8 characters of the id, as a search prints them, are enough. |
| `/lookback fix <error>` | Sessions that hit the same error, with what each ran or changed and how that turn ended. |
| `/lookback how <words>` | The shell commands that hold every word, the most run first. |
| `/lookback blame <file>` | The sessions that changed a file, with what you had asked for. The end of a path is enough. |
| `/lookback files <id>` | The files one session touched, the most changed first. |
| `/lookback forget <id>` | Removes a session from the index and keeps it out. `forget --undo <id>` lets it back in; `forget --list` shows what is forgotten. |
| `/lookback`, `stats`, `doctor`, `index` | Index size, health check, or a manual update. |
| Claude calls `mcp__lookback__search` | Same search, with `query`, and optional `project`, `since` (`12h`, `30d`, `2w`), `limit` and `offset`. `mode` is `search`, `fix`, `how` or `blame`; `session` reads one session; `kind` narrows a search or a session read to some kinds. The current session is left out. Claude cannot forget a session; only you can. |

`fix` and `how` in `/lookback` fall back to a normal search when they find nothing, so "how did we fix the build" still works as a question.

A result reads as the session went:

```text
2026-10-01  app  bbbb2222
  changed   app/requirements.txt
  asked     Make the thumbnails for the gallery
  cmd       pip install -r requirements.txt
  ended     Pillow is in the requirements and installed; the gallery thumbnails are made.
  reply     good, commit it
```

`asked` is the prompt that opened the turn, the lines with a kind are the matches, `ended` is the last thing Claude said in the turn, and `reply` is what you typed next. The reply is the evidence of whether the answer held: "commit it" and "no, still broken" tell two different stories about the same `ended` line.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `limit` | 5 | Sessions a search returns (1 to 15). |
| `autoRecall` | on | Add matches beside prompts that ask about the past. |
| `autoIndex` | on | Update the index when a session starts. |
| `errorHints` | on | After a failed shell command, look up what past sessions ran next. |
| `fileTools` | empty | MCP tools or whole servers whose calls read or change files, split by commas: `mcp__semantic-cache-mcp` for a server, `mcp__myserver__edit` for one tool. A `lookback index` run by hand with no `LOOKBACK_FILE_TOOLS` keeps this setting; an empty `LOOKBACK_FILE_TOOLS=` clears it. |
| `embeddingModel` | `nomic-embed-text` | Any model the server offers. A new model rebuilds the vectors. |
| `embeddingUrl` | `http://localhost:11434/v1` | An OpenAI-style endpoint. |

## Command line

```bash
bun bin/lookback.ts index
bun bin/lookback.ts search "No module named PIL" --since 30d --project glowseed
bun bin/lookback.ts search "double brackets" --limit 5 --offset 5
bun bin/lookback.ts show d18dbf28 --offset 60
bun bin/lookback.ts fix "ModuleNotFoundError: No module named 'PIL'"
bun bin/lookback.ts how plugin test
bun bin/lookback.ts blame src/runtime/store/store.ts
bun bin/lookback.ts files d18dbf28
bun bin/lookback.ts forget d18dbf28
bun bin/lookback.ts stats
bun bin/lookback.ts doctor
```

`search` flags: `--limit`, `--offset`, `--project`, `--kind user|assistant|thinking|error|cmd|edit`, `--since`, `--exclude <session>`, `--keyword`, `--json`.
`show` flags: `--offset`, `--limit`, `--kind`, `--json`. `fix` and `how` take `--limit`, `--project`, `--since`, `--json`.
Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.

Environment: `LOOKBACK_PROJECTS` (default `~/.claude/projects`), `LOOKBACK_DB` (default `$XDG_DATA_HOME/lookback/index.sqlite`), `LOOKBACK_EMBEDDING_URL`, `LOOKBACK_EMBEDDING_MODEL`, `LOOKBACK_EMBEDDING_KEY`, `LOOKBACK_FILE_TOOLS`, `LOOKBACK_SQLITE_LIB`.

## How it works

1. **Read.** Each transcript is read from the byte offset where the last run stopped, in chunks. Notices that a background task ended are cut out of prompts. A message another Claude session sent is read as a prompt, since it is what the session was asked to do. Other meta rows, compaction summaries, thinking blocks with no readable text, and injected blocks (`<system-reminder>`, `<lookback-recall>`) are dropped.
2. **Store.** Entries go into SQLite, with an FTS5 full-text index that SQLite keeps current as rows change. There are six kinds: `user`, `assistant`, `thinking`, `error`, `cmd` and `edit`. Entries of every kind are cut into up to 4 chunks of 1,200 characters and embedded with the `search_document:` prefix. Vectors are stored as 32-bit floats; the [sqlite-vector](https://github.com/sqliteai/sqlite-vector) extension keeps an 8-bit copy for fast scans.
3. **Search.** A query runs two ways: FTS5's BM25 over the words, with stemming so "fixing" finds "fixed", and a cosine scan over the vectors (`search_query:` prefix). Each search gives its best prose (`user`, `assistant`, `thinking`, `error`) and its best code (`cmd`, `edit`) apart, so neither can fill every place. The two lists are merged by score: each score is scaled between a fixed floor and the best of its list, and the two are added with a balance set for the question. The balance is even when both lists stand out alike, and leans toward the list whose best entries stand out more: an exact name gives a word list with a clear leader, and a loose question gives one where everything matches alike. Entries are grouped by session, weighted by kind and age (90-day half-life), and repeats of the same text are shown once. A session where something said matched shows one line of code at most. A session in a project whose folder name holds a word of the question counts for 1.3 times as much, so "the garden game" finds `glowseed-garden`. A session that scores under 40% of the best one is left out, unless one of its entries holds every word of the question.
4. **Surround.** Each match is shown inside its turn, and the turns of a session oldest first: the prompt that opened the turn (`asked`), the matches, the last thing Claude said before the next prompt (`ended`), and that next prompt (`reply`). A session also lists up to three files it changed, the most changed first. A text is shown once in a session.
5. **Fall back.** If the embedding server does not answer within 4 s, the search uses words only and says so.

**Secrets.** Before an entry is stored, keys and passwords in it are replaced by a marker such as `[redacted:github-token]`. Covered: private key blocks, keys of GitHub, Anthropic, OpenAI, AWS, Slack, Google and Stripe, JWTs, bearer tokens, passwords in URLs, and values given to a name like `API_KEY` or `password` when the value looks generated. The index never holds the secret; the transcript on disk is not changed. `lookback stats` counts the entries that were redacted. A secret of a shape not listed here is not caught.

**Files.** Each tool call that names a file is recorded: the path, the session, the time, and whether the call read or changed the file. The built-in `Read`, `Edit`, `Write`, `MultiEdit` and `NotebookEdit` are always recorded. An MCP tool is recorded only when `fileTools` names it or its server, since nothing in a transcript says which MCP tools work on files. The path is read from the input keys `file_path`, `path`, `notebook_path` and `paths`. A tool counts as a change when its name holds a word like `edit`, `write` or `delete`; any other counts as a read. When `fileTools` changes, the next index run reads the transcripts again for files and edits only; the other entries and the vectors stay.

**Edits.** Each change one of those tools makes is also an entry of kind `edit`: the path, then the text replaced after `-` and the text written after `+`, each cut at 1,800 characters. A batch of edits gives one entry for each pair. `--kind edit` searches them alone.

**Sub-agents.** A sub-agent's transcript is indexed as its own session, named by the agent's id and linked to the session that started it. A result from one says `sub-agent of <id>`. Leaving a session out of a search, or forgetting it, takes its sub-agents with it. `stats` counts them apart from sessions.

**Thinking.** A thinking block is an entry of kind `thinking` when its text is in the transcript. Most are stored as a signature with no text, and those are skipped.

**Fix.** `fix` matches on words only, among failed tool results. Each word of the error asked about weighs more the fewer past errors hold it, so `TS2345` counts for far more than `error`. An error counts as the same one when the words it shares carry at least 60% of that weight. For each session it shows the first two commands and the first edit made before the next prompt, then the last thing Claude said in that turn. A session that ran and changed nothing after the error is left out.

The index uses write-ahead logging, so searches work while an index run writes. Only one index run writes at a time; a second one exits at once.

The 8-bit copy of the vectors is a snapshot. Each index run rebuilds it, which takes well under a second for tens of thousands of vectors. If vectors were stored after the last rebuild, searches scan the full vectors instead: exact, and a few times slower. The full vectors stay in the file, so the copy can be rebuilt, or its format changed, without calling the embedding model again.

## Layout

```
bin/lookback.ts        entry point
hooks/register.ts      the mod: tool, command, prompt recall, background index
src/core/              pure code; also runs inside the plugin sandbox
src/runtime/           SQLite, Ollama and file code; runs under Bun only
src/cli/               command line
tests/*.test.ts        sandbox tests:   claude plugin test .
tests/runtime/*.spec.ts  Bun tests:     bun test tests/runtime
```

The plugin sandbox allows no `node:` modules and no npm packages. That is why `src/core` holds everything the hook module imports, and the database and network code sits behind the command line. The hook talks to it by running `bun bin/lookback.ts`.

## Limits

- Claude Code transcripts only. Other tools can be added as readers later.
- Runs started with `claude -p` are not indexed, nor are the files they changed: a script or a mod asked, not you.
- The macOS path is covered by unit tests only; it has not been run on a Mac.
- `fix` shows what came next in the session, which is not always what solved the error. Read it as a lead.
- A session that was forgotten keeps its rows in the 8-bit vector copy until the next index run with new vectors; searches never return them.
- Files changed by a shell command are not recorded.
- A sub-agent's first prompt, and a message from another Claude session, are stored as kind `user`, though Claude wrote them.
- A word matches from its start: "cache" finds "CachedResolver", but "Resolver" does not.
- Resumed sessions that copy rows into a new file can appear twice in the index.
- Only the first 4,800 characters of an entry are embedded; the words search covers the whole entry.
