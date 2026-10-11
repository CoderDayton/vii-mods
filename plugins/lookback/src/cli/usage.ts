export const USAGE = `Usage: lookback <command> [options]

Search your past Claude Code sessions by words and by meaning.

Commands:
  lookback index [--no-embed] [--quiet]
      Read new transcript lines into the index, then embed them.
  lookback search <question...> [options]
      Find past sessions. Options:
        --limit <n>        sessions to return (default 5)
        --project <text>   only sessions whose folder contains the text
        --kind <kind>      user, assistant, error or cmd; repeatable
        --since <span>     only the last span, such as 12h, 30d or 2w
        --exclude <id>     leave one session out, usually the current one
        --keyword          match on words only; do not call the embedding server
        --json             print the result as JSON
  lookback stats [--json]
      What the index holds.
  lookback doctor
      Check the index, the transcripts and the embedding server.

Settings come from the environment: LOOKBACK_PROJECTS, LOOKBACK_DB,
LOOKBACK_EMBEDDING_URL, LOOKBACK_EMBEDDING_MODEL, LOOKBACK_EMBEDDING_KEY,
LOOKBACK_SQLITE_LIB (a libsqlite3 to use in place of Bun's; macOS needs one).

Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.
`
