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
| Any session | The system prompt gets one short section that says when to search: before debugging an error or redoing work, and when you imply the work happened before. The tool sits in the prompt's own tool list, not behind tool search, so Claude reads its description. |
| Start a session in a folder with history | When `sessionDigest` is on, the system prompt lists the 5 latest sessions run in that exact folder that have a title: day, folder, id and title, then a line on how the session ended. A session with no title is mostly one another session drove, and is left out. The section asks Claude to open one by its id before acting when it bears on the next request, and to say in one line (`lookback: <what> — <how used> (<id>)`) when recalled history helped. |
| Ask about earlier work | When `autoRecall` is on, up to 2 sessions are added beside the prompt as `<lookback-recall>` data, each with up to 2 turns. The new turns of the current session are read into the index first. Its earlier turns are searched too, marked `this session, earlier`, and count 1.5 times as much. Only the exchange just before the question is left out. Claude is told to use such a turn for what a compaction took out of its context, and to pass over what it still sees. The words of the last exchange name the topic, so "did u rebuild it?" finds what "it" was. What Claude said ranks well above your own prompts. An entry is shown only when it holds 3 topic words, so many prompts add nothing. It takes about 0.5 s to 1.2 s. A prompt counts when it holds a cue that points back: a question about what you or Claude did ("did u rebuild it?", "why did we remove that"), an earlier result ("what was the v5 accuracy"), something said or shown ("like you said", "the example I gave you"), another session, "last time", or a request to put something back. Texting spelling is read ("u", "didnt", "howd"). Code, quotes, links and "what if" clauses are not read. |
| Send any prompt | When `autoRecall` is on and the prompt has 25 or more characters, it is checked by meaning. A past user or assistant text from the same folder that scores at least 0.80 cosine similarity and shares at least 2 uncommon words with the prompt adds up to 2 sessions as `<lookback-recall>` data. A session already shown is not shown again. About 3% to 7% of real prompts pass. The check adds about 0.15 s once the embedding server is warm, and gives up after 1.5 s of embedding (4 s in all) with no output. |
| Read or change a file | When `fileNotes` is on, the first call in a session that names a file changed by 2 or more earlier sessions carries one note as `<lookback-file>` data: how many sessions changed it, and the latest 3 with what was asked. It covers the built-in Read, Edit and Write and the tools named in `fileTools`. Each file is noted once per session. A relative path is read from the session's folder, so a file with the same name in another project does not count. |
| A shell command fails | When `errorHints` is on, Claude gets what past sessions ran after the same error, as `<lookback-fix>` data with the result. Each error is looked up once per session. |
| `/lookback <question>` | Prints the matching sessions, each match inside its turn. A last line names the offset of the next page. |
| `/lookback show <id> [offset]` | Reads one session in order. The first 8 characters of the id, as a search prints them, are enough. |
| `/lookback recent` | The 10 latest sessions of every folder, newest first, each with its title. |
| `/lookback fix <error>` | Sessions that hit the same error, with what each ran or changed and how that turn ended. |
| `/lookback how <words>` | The shell commands that hold every word, the most run first. |
| `/lookback blame <file>` | The sessions that changed a file, with what you had asked for. The end of a path is enough. |
| `/lookback files <id>` | The files one session touched, the most changed first. |
| `/lookback forget <id>` | Removes a session from the index and keeps it out. `forget --undo <id>` lets it back in; `forget --list` shows what is forgotten. |
| `/lookback`, `stats`, `doctor`, `index` | Index size, health check, or a manual update. |
| Claude calls `mcp__lookback__search` | Same search, with `query`, and optional `project`, `since` (`12h`, `30d`, `2w`), `limit` and `offset`. `mode` is `search`, `fix`, `how` or `blame`; `session` reads one session; `kind` narrows a search or a session read to some kinds. A search also covers the earlier turns of the current session, read into the index just before, and marks them `this session, earlier`; the turn in progress is left out. So after a compaction Claude can look up what the summary dropped. `fix` and `how` leave the current session out. Claude cannot forget a session; only you can. |

`fix` and `how` in `/lookback` fall back to a normal search when they find nothing, so "how did we fix the build" still works as a question.

A result reads as the session went:

```text
2026-10-01  app  bbbb2222  Gallery thumbnails
  changed   app/requirements.txt
  asked     Make the thumbnails for the gallery
  cmd       pip install -r requirements.txt
  ended     Pillow is in the requirements and installed; the gallery thumbnails are made.
  reply     good, commit it
```

The first line ends with the session's title, when it has one. `asked` is the prompt that opened the turn, the lines with a kind are the matches, `ended` is the last thing Claude said in the turn, and `reply` is what you typed next. The reply is the evidence of whether the answer held: "commit it" and "no, still broken" tell two different stories about the same `ended` line.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `limit` | 5 | Sessions a search returns (1 to 15). |
| `autoRecall` | on | Add matches beside prompts that ask about the past, and beside prompts that match a past session by meaning. |
| `autoIndex` | on | Update the index when a session starts. |
| `errorHints` | on | After a failed shell command, look up what past sessions ran next. |
| `sessionDigest` | on | List the folder's 5 latest sessions in the system prompt at session start. |
| `fileNotes` | on | Note a file's history the first time a session touches it. |
| `fileTools` | empty | MCP tools or whole servers whose calls read or change files, split by commas: `mcp__semantic-cache-mcp` for a server, `mcp__myserver__edit` for one tool. A `lookback index` run by hand with no `LOOKBACK_FILE_TOOLS` keeps this setting; an empty `LOOKBACK_FILE_TOOLS=` clears it. |
| `embeddingModel` | `nomic-embed-text` | Any model the server offers. A new model rebuilds the vectors. |
| `embeddingUrl` | `http://localhost:11434/v1` | An OpenAI-style endpoint. |
| `captionServer` | empty | A `llama-server` command with a vision model, to caption images you paste: `llama-server -m model.gguf --mmproj mmproj.gguf` plus any flags. lookback starts it only for an index run that has images to caption, on a free local port (it adds `--host` and `--port`), and stops it when done. Quotes hold a path with spaces. |
| `captionModel` | empty | A vision model a running server serves, such as `lfm2.5-vl-1.6b` in Ollama. Used when `captionServer` is empty; with both empty, images are not read. |
| `captionUrl` | `http://localhost:11434/v1` | The OpenAI-style endpoint for `captionModel`. Your screenshots are sent there. |

## Command line

```bash
bun bin/lookback.ts index
bun bin/lookback.ts search "No module named PIL" --since 30d --project glowseed
bun bin/lookback.ts search "double brackets" --limit 5 --offset 5
bun bin/lookback.ts show d18dbf28 --offset 60
bun bin/lookback.ts recent --project /home/me/work/app
bun bin/lookback.ts fix "ModuleNotFoundError: No module named 'PIL'"
bun bin/lookback.ts how plugin test
bun bin/lookback.ts blame src/runtime/store/store.ts
bun bin/lookback.ts recall "can we move the commits to a new release branch" --project /home/me/work/app
bun bin/lookback.ts recall --asked --session d18dbf28-1111-2222-3333-444444444444 "did you rebuild it?"
bun bin/lookback.ts files d18dbf28
bun bin/lookback.ts forget d18dbf28
bun bin/lookback.ts stats
bun bin/lookback.ts doctor
```

`search` flags: `--limit`, `--offset`, `--project`, `--kind user|assistant|thinking|error|cmd|edit|summary|call|result|image`, `--since`, `--exclude <session>`, `--own <session>` (search that session too, up to its last prompt, after reading its new turns), `--keyword`, `--json`.
`search --best` lists the best match first. `show` flags: `--offset`, `--limit`, `--kind`, `--json`. `recent` flags: `--project <full folder path>`, `--exact` (that folder only), `--titled`, `--limit`, `--exclude <session>`, `--json`. `blame --brief [--min <n>] [--exclude <session>]` prints the short file note, or nothing. `blame --project <folder>` reads the path from that folder and matches that one file only. `recall <prompt>` takes `--project <folder>`, `--exclude <session>` and `--skip <ids by commas>`, and prints nothing when no past session answers the prompt. `recall --asked --session <full id> <prompt>` treats the prompt as a question about earlier work, and prints nothing when no turn is on topic. `fix` and `how` take `--limit`, `--project`, `--since`, `--json`.
Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.

Environment: `LOOKBACK_PROJECTS` (default `~/.claude/projects`), `LOOKBACK_DB` (default `$XDG_DATA_HOME/lookback/index.sqlite`), `LOOKBACK_EMBEDDING_URL`, `LOOKBACK_EMBEDDING_MODEL`, `LOOKBACK_EMBEDDING_KEY`, `LOOKBACK_FILE_TOOLS`, `LOOKBACK_CAPTION_SERVER`, `LOOKBACK_CAPTION_MODEL`, `LOOKBACK_CAPTION_URL`, `LOOKBACK_CAPTION_KEY`, `LOOKBACK_SQLITE_LIB`.

## How it works

1. **Read.** Each transcript is read from the byte offset where the last run stopped, in chunks. Notices that a background task ended are cut out of prompts. A message another Claude session sent is read as a prompt, since it is what the session was asked to do. An answer you picked when Claude asked a question is read as a prompt too, as `Asked: … Chose: …`. A title row names its session; a title you typed is kept over one Claude Code wrote. A row copied into another file by a resumed session is stored once, by its row id. A compaction summary is read whole as a `summary`. A call to any tool other than Bash, AskUserQuestion and the tools that edit files is a `call`: the tool's name and the fields of its input. What a call returned, when it worked and said at least 40 characters, is a `result`, headed by the call's tool and its path, URL, query or command, also when the call was read in an earlier run; the answer to a file edit or a question is left out. Calls and results follow the file-tools setting in force when a transcript was read. With captions on, each image you pasted into a prompt is read; images a tool returned are not. Other meta rows, thinking blocks with no readable text, and injected blocks (`<system-reminder>`, `<lookback-recall>`) are dropped.
2. **Store.** Entries go into SQLite, with an FTS5 full-text index that SQLite keeps current as rows change. There are ten kinds: `user`, `assistant`, `thinking`, `error`, `summary`, `cmd`, `edit`, `call`, `result` and `image`. A text over 4,000 characters is stored as up to 4 entries, split at paragraph ends, so a search can match its end. Entries of every kind are cut into up to 4 chunks of 1,200 characters and embedded with the `search_document:` prefix. Vectors are stored as signed bytes (`INT8`), each scaled so its largest value is 127: 768 bytes a passage, a quarter of 32-bit floats. Against the exact float scan, the 10 nearest passages agree 98% of the time; 4-bit TurboQuant agrees 94%. The [sqlite-vector](https://github.com/sqliteai/sqlite-vector) extension scans them with no index to rebuild, so a stored vector is found at once.
3. **Search.** A query runs two ways: FTS5's BM25 over its words (filler left out, a long query keeps the 8 words held by the fewest entries, and with 3 or more words an entry must hold two fifths of them, rounded up, to count as a word match; meaning matches have no such rule), with stemming so "fixing" finds "fixed", and a cosine scan over the vectors (`search_query:` prefix). Each search gives its best prose (`user`, `assistant`, `thinking`, `error`, `summary`, `image`), its best code (`cmd`, `edit`) and its best tool traffic (`call`, `result`) apart, so none can fill every place. A `result` weighs 0.6, a `call` 0.7 and a `summary` 0.95 against 1 for an answer. The two lists are merged by score: each score is scaled between a fixed floor and the best of its list, and the two are added with a balance set for the question. The balance is even when both lists stand out alike, and leans toward the list whose best entries stand out more: an exact name gives a word list with a clear leader, and a loose question gives one where everything matches alike. Entries are grouped by session, weighted by kind and age (90-day half-life), and repeats of the same text are shown once. A session where something said matched shows one line of code, call or result at most. A session in a project whose folder name holds a word of the question counts for 1.3 times as much, so "the garden game" finds `glowseed-garden`. A session that scores under 40% of the best one is left out, unless one of its entries holds every word of the question. A folder the question names is also searched apart, for up to 3 folders, since its sessions may never say its name. The sessions of a page are picked by score and listed newest first; `--best` lists the best first.

   **Words about time** are read in local time and are not searched for. A span limits the search: `today`, `yesterday`, `last night`, a weekday, `this week`, `last week`, `this month`, `last month`, `in september`, `3 days ago`, `the last 2 weeks`, `sept 21`, `21 sep 2026`, `2026-09-21`, and a time such as `at 3pm` (an hour each side). `since`, `after` and `before` give one bound, and two of them a range, as do `between sept 21 and sept 25` and `from sept 21 to sept 25`. Every time in a question is read: two or more are covered from the first start to the last end, so `yesterday or last week` is the whole of both. A time of day is dropped when the question names more than one time. A date with no year is the latest one that has come. `latest`, `newest`, `most recent`, `recently` and `last session` ask for the newest work: sessions that score half of the best one, and those run in a folder the question names, are listed newest first, without sub-agent runs. A question about time alone ("what did we do yesterday") lists the sessions of that time, each with the last thing Claude said. Text in quotes or backticks is never read for time, and `--since` wins over a span in the question.
4. **Surround.** Each match is shown inside its turn, and the turns of a session oldest first: the prompt that opened the turn (`asked`), the matches, the last thing Claude said before the next prompt (`ended`), and that next prompt (`reply`). A session also lists up to three files it changed, the most changed first. A text is shown once in a session.
5. **Fall back.** If the embedding server does not answer within 4 s, the search uses words only and says so.

**Questions about earlier work.** `recall --asked` is the search above with four changes. It first reads the new lines of the asking session's transcripts and embeds them for up to 2.5 s. It takes up to 8 topic words from the last prompt (600 characters) and the last answer (2,000 characters) before the question: words said often there and held by 3 or more entries but at most 5% of them, leaving out numbers and hashes. Those words are matched beside the words of the question. An entry is kept only when it holds 3 of the topic words and the question's own uncommon words together, or all of them when there are fewer. Prompts weigh 0.4 and Claude's answers 1.15. The asking session is searched up to its last prompt, since the last exchange would match its own words.

**Secrets.** Before an entry is stored, keys and passwords in it are replaced by a marker such as `[redacted:github-token]`. Covered: private key blocks, keys of GitHub, Anthropic, OpenAI, AWS, Slack, Google and Stripe, JWTs, bearer tokens, passwords in URLs, and values given to a name like `API_KEY` or `password` when the value looks generated. The index never holds the secret; the transcript on disk is not changed. `lookback stats` counts the entries that were redacted. A secret of a shape not listed here is not caught.

**Files.** Each tool call that names a file is recorded: the path, the session, the time, and whether the call read or changed the file. The built-in `Read`, `Edit`, `Write`, `MultiEdit` and `NotebookEdit` are always recorded. An MCP tool is recorded only when `fileTools` names it or its server, since nothing in a transcript says which MCP tools work on files. The path is read from the input keys `file_path`, `path`, `notebook_path` and `paths`. A tool counts as a change when its name holds a word like `edit`, `write` or `delete`; any other counts as a read. When `fileTools` changes, the next index run reads the transcripts again for files and edits only; the other entries and the vectors stay.

**Edits.** Each change one of those tools makes is also an entry of kind `edit`: the path, then the text replaced after `-` and the text written after `+`, each cut at 1,800 characters. A batch of edits gives one entry for each pair. `--kind edit` searches them alone.

**Images.** With `captionServer` or `captionModel` set, each image you paste is saved once as `images/<sha256>.<ext>` beside the index, readable by you alone, since the transcript's copy goes with old sessions and the pasted file often sits in `/tmp`. An index run then captions the images that have none: the model is asked to transcribe all visible text and say in one line what app it shows, at temperature 0.1 with at most 400 tokens. A caption that falls into a loop is cut after the first copy of the repeated phrase, and secrets in it are redacted. The caption becomes an entry of kind `image`, found by words and by meaning like any other; a result shows the caption, then the saved path. The path is stored with the entry but neither matched nor embedded, so "png" or a folder name does not find every image. The same image pasted twice is captioned once. A run with no new image starts no server and loads no model; Ollama is asked to unload the model 15 s after the last caption. If the server cannot start or two images fail in a row, the rest wait for the next run. An image that has failed in 3 runs is not tried again; a saved file that is gone counts as a failure but does not stop the others. On Linux the server is started under `setpriv --pdeathsig KILL`, so it ends with lookback even when lookback is killed outright. Turning captions on reads the transcripts already indexed for pastes once. A `lookback index` run by hand with neither `LOOKBACK_CAPTION_SERVER` nor `LOOKBACK_CAPTION_MODEL` set keeps the setting in force; an empty one turns captions off. Forgetting a session deletes the images no other session holds.

**Sub-agents.** A sub-agent's transcript is indexed as its own session, named by the agent's id and linked to the session that started it. A result from one says `sub-agent of <id>`. Leaving a session out of a search, or forgetting it, takes its sub-agents with it. `stats` counts them apart from sessions.

**Thinking.** A thinking block is an entry of kind `thinking` when its text is in the transcript. Most are stored as a signature with no text, and those are skipped.

**Fix.** `fix` matches on words only, among failed tool results. Each word of the error asked about weighs more the fewer past errors hold it, so `TS2345` counts for far more than `error`. An error counts as the same one when the words it shares carry at least 60% of that weight. For each session it shows the first two commands and the first edit made before the next prompt, then the last thing Claude said in that turn. A session that ran and changed nothing after the error is left out.

**Old sessions.** Claude Code deletes a transcript after 30 days by default (`cleanupPeriodDays`). The index keeps what it read, so a session stays searchable after its file is gone. A new version of the mod upgrades the index in place: it reads every transcript still on disk again, and keeps the sessions it can no longer read as they are.

The index uses write-ahead logging, so searches work while an index run writes. Only one index run writes at a time; a second one exits at once, or with `--wait`, as `/lookback index` runs it, waits up to 60 s for the first to end.

A search limited to a folder and to some kinds, as prompt recall is, that leaves 6,000 passages or fewer scores those passages one by one instead, about 20 ms for 1,700, with the same cosine distance as the scan. Any other search by meaning reads the 2,000 nearest passages first, about 60 ms over 300,000. When those prove the answer, that is all it reads: every entry it returns is nearer than the farthest of them, so nothing outside them could rank higher. Otherwise it scans every passage of the kinds still short of entries, checked against the filter before ranking, and keeps what the first pass proved for the rest. The searches of one question, one per folder it names, share the first pass. An index whose vectors are 32-bit floats is converted in place the first time it is opened, which takes a few seconds and shrinks the file by about two thirds.

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
- Files changed by a shell command are not recorded.
- A sub-agent's first prompt, and a message from another Claude session, are stored as kind `user`, though Claude wrote them.
- A word matches from its start: "cache" finds "CachedResolver", but "Resolver" does not.
- A row a resumed session copied belongs to the session whose file was read first. So does a file change in such a row: it counts once.
- Forgetting a session also removes the rows a resumed session copied from it. The file changes in those rows then count for the resumed session.
- A text is stored up to 16,000 characters (4 entries); the rest is not searchable.
- Recall by meaning needs vectors and a running embedding server; with neither it adds nothing. It looks at the same folder only, so work done under a different folder is found by a search, not by this.
- A file note comes after the call's result, so the first edit of a file is made before Claude reads its note.
- Error hints follow failed shell commands only. Failed MCP tool calls are mostly wrong arguments, which past sessions do not help with.
- A session title is shown, not searched.
- An image pasted during a session is captioned by the next index run, at the start of a later session or by `/lookback index`.
- A caption is as good as the vision model: small models misname apps and miss small text in large screenshots.
- A session whose transcript is gone keeps the shape it was read in: a text cut at 4,000 characters stays cut, and it gets no title.
- Deleting the index file loses every session whose transcript is gone. Back it up if that history matters.
