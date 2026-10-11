export const USAGE = `Usage: lookback <command> [options]

Search your past Claude Code sessions by words and by meaning.

Commands:
  lookback index [--no-embed] [--quiet]
      Read new transcript lines into the index, then embed them.
  lookback search <question...> [options]
      Find past sessions. Options:
        --limit <n>        sessions to return (default 5)
        --offset <n>       pass over the best n sessions, to read the next page
        --project <text>   only sessions whose folder contains the text
        --kind <kind>      user, assistant, thinking, error, cmd or edit; repeatable
        --since <span>     only the last span, such as 12h, 30d or 2w
        --exclude <id>     leave one session out, usually the current one
        --keyword          match on words only; do not call the embedding server
        --json             print the result as JSON
  lookback show <session id> [--offset <n>] [--limit <n>] [--kind <kind>] [--json]
      Read one session in order. The start of an id is enough.
  lookback fix <error text...> [--limit <n>] [--project <text>] [--since <span>] [--exclude <id>] [--json]
      Past sessions that hit the same error, with what each ran or changed and how that turn ended.
  lookback how <words...> [--limit <n>] [--project <text>] [--since <span>] [--json]
      The shell commands that hold every word, the most run first.
  lookback blame <file path> [--reads] [--limit <n>] [--json]
      The sessions that changed a file, with what was asked before. The end
      of a path is enough. --reads adds sessions that only read it.
  lookback files <session id> [--limit <n>] [--json]
      The files one session touched, the most changed first.
  lookback forget <session id> | --undo <session id> | --list
      Remove one session from the index and keep it out. --undo lets it back
      in; --list shows what is forgotten.
  lookback stats [--json]
      What the index holds.
  lookback doctor
      Check the index, the transcripts and the embedding server.

Settings come from the environment: LOOKBACK_PROJECTS, LOOKBACK_DB,
LOOKBACK_EMBEDDING_URL, LOOKBACK_EMBEDDING_MODEL, LOOKBACK_EMBEDDING_KEY,
LOOKBACK_FILE_TOOLS (MCP tools or servers whose calls name files, by commas),
LOOKBACK_SQLITE_LIB (a libsqlite3 to use in place of Bun's; macOS needs one).

Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.
`
