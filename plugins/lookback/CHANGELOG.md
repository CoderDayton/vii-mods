# Changelog

lookback is at version 0.1.0. Changes are listed by date, newest first.

## 2026-10-17

### Added
- Captions for pasted images, off by default. Set `captionServer` to a llama-server command with a vision model, and lookback starts it for each run and stops it after. Or set `captionModel` (and `captionUrl`) to use a server that is already running. Captions are searched as the `image` kind. The image path is kept but not searched.
- An image the model turns down in 3 runs is skipped for good. Captioning stops for the run when the model turns down two images in a row, or at once when the server can't be reached. A server that can't be reached costs no image a try.
- Captions run after the rest of the index has its vectors, then the new captions get theirs.
- `fix` and session reads show an image's caption first and its file name last.
- On Linux, a caption server started by lookback dies with it, even if lookback is killed.
- `lookback index --wait` waits up to 60 s for an index run that is already going. `/lookback index` uses it.
- `lookback doctor` checks the caption setup and the model files named in `captionServer`, in both `-m path` and `--mmproj=path` forms.

### Changed
- `/lookback index` prints what it did, such as `Read 3 transcripts in 2s: 300 new entries, 407 vectors.`, or `Nothing new: the index is up to date.`. Notices that used to be dropped are now shown.
- A toast says when image captions stopped during a background index run.

### Faster
Times are end to end, including startup.

| Command | Before | After |
|---|---|---|
| `recall` (each prompt) | 134 ms | 97 ms |
| `recall --asked` | 646 ms | 365 ms |
| `search` | 514 ms | 252 ms |
| `recent` (session start) | 191 ms | 26 ms |
| `blame --brief` | 46 ms | 25 ms |
| `index`, nothing new | 387 ms | 69 ms |

- New indexes for session and folder lookups.
- Looking for entries that still need vectors no longer scans every entry.
- Prose, code and tool results are ranked by keyword in one pass, not three.
- A search limited to one folder and some kinds, with 6,000 passages or fewer, scores those passages directly instead of scanning all vectors.
- The OpenAI client loads only when a command needs it.

### Index
- Schema 14. The first index run after the update migrates the index, in a few seconds. Until then, searches report that there is no index.

## 2026-10-15

### Added
- Calls to tools other than Bash and file edits, successful tool results, and compaction summaries are indexed as the `call`, `result` and `summary` kinds. They are searched apart from prose so they don't crowd it out.
- Tool calls still open at the end of a run are matched with their results on the next run.

### Changed
- Vectors are stored as INT8, about a quarter of the size of float32. Schema 10 converts an existing index in place.
- A first pass over the 2,000 nearest passages settles most searches. Small kind groups are searched again with a prefilter.

## 2026-10-13

### Added
- Recall beside prompts: past work related to a prompt is shown next to it, newest first.
- Time words in queries, such as `yesterday`, `last week`, `since friday` and `sept 21`.
- Search inside the current session, file notes per folder, and search limited to a named folder.

### Changed
- A long query keeps its rarest words, and a keyword match needs two fifths of them.

## 2026-10-11

### Added
- Search of past Claude Code sessions by words and by meaning. The index is SQLite with FTS5 and sqlite-vector, and the embeddings come from Ollama.
- The `search` tool, the `/lookback` command, and recall beside prompts.
- Thinking, shell commands, file edits and sub-agent runs are indexed. The file tools are set with `fileTools`.
- The `show`, `forget`, `fix`, `how`, `blame` and `files` commands, paging, and secret redaction.
- Each hit shows the prompt that opened its turn, how the turn ended and the reply that came next.
- Word and meaning scores are fused, with a balance set per query. Weak sessions are dropped.
- Headless runs are skipped. Transcripts are read in 1 MB chunks.
