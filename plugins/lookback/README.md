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
| `/lookback <question>` | Prints the matching sessions. |
| `/lookback`, `stats`, `doctor`, `index` | Index size, health check, or a manual update. |
| Claude calls `mcp__lookback__search` | Same search, with `query`, and optional `project`, `since` (`12h`, `30d`, `2w`) and `limit`. The current session is left out. |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `limit` | 5 | Sessions a search returns (1 to 15). |
| `autoRecall` | on | Add matches beside prompts that ask about the past. |
| `autoIndex` | on | Update the index when a session starts. |
| `embeddingModel` | `nomic-embed-text` | Any model the server offers. A new model rebuilds the vectors. |
| `embeddingUrl` | `http://localhost:11434/v1` | An OpenAI-style endpoint. |

## Command line

```bash
bun bin/lookback.ts index
bun bin/lookback.ts search "No module named PIL" --since 30d --project glowseed
bun bin/lookback.ts stats
bun bin/lookback.ts doctor
```

`search` flags: `--limit`, `--project`, `--kind user|assistant|error|cmd`, `--since`, `--exclude <session>`, `--keyword`, `--json`.
Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.

Environment: `LOOKBACK_PROJECTS` (default `~/.claude/projects`), `LOOKBACK_DB` (default `$XDG_DATA_HOME/lookback/index.sqlite`), `LOOKBACK_EMBEDDING_URL`, `LOOKBACK_EMBEDDING_MODEL`, `LOOKBACK_EMBEDDING_KEY`, `LOOKBACK_SQLITE_LIB`.

## How it works

1. **Read.** Each transcript is read from the byte offset where the last run stopped, in chunks, so memory stays flat. Sub-agent files, meta rows, thinking blocks, and injected blocks (`<system-reminder>`, `<lookback-recall>`) are dropped.
2. **Store.** Entries (user, assistant, error, command) go into SQLite, with an FTS5 full-text index that SQLite keeps current as rows change. User, assistant and error entries are cut into up to 4 chunks of 1,200 characters and embedded with the `search_document:` prefix. Vectors are stored as 32-bit floats; the [sqlite-vector](https://github.com/sqliteai/sqlite-vector) extension keeps an 8-bit copy for fast scans.
3. **Search.** A query runs two ways: FTS5's BM25 over the words, with stemming so "fixing" finds "fixed", and a cosine scan over the vectors (`search_query:` prefix). Reciprocal rank fusion merges the two lists. Entries are grouped by session, weighted by kind and age (90-day half-life), and repeats of the same text are shown once.
4. **Fall back.** If the embedding server does not answer within 4 s, the search uses words only and says so.

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
- The macOS path is covered by unit tests only; it has not been run on a Mac.
- A word matches from its start: "cache" finds "CachedResolver", but "Resolver" does not.
- Resumed sessions that copy rows into a new file can appear twice in the index.
- Only the first 4,800 characters of an entry are embedded; the words search covers the whole entry.
