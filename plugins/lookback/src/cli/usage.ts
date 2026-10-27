export const USAGE = `Usage: lookback <command> [options]

Search your past Claude Code sessions by words and by meaning.

Commands:
  lookback index [--no-embed] [--quiet] [--wait]
      Read new transcript lines into the index, then embed them. A run that
      finds another one writing exits at once; with --wait it waits up to 60 s.
  lookback search <question...> [options]
      Find past sessions, listed newest first. Words about time in the
      question are read, not searched for: "yesterday", "last week",
      "3 days ago", "since friday", "sept 21", "at 3pm" set the span, and
      "latest" or "most recent" asks for the newest matches. A question
      about time alone lists the sessions of that time. Two times in one
      question cover both; "between X and Y" is a range. Options:
        --limit <n>        sessions to return (default 5)
        --offset <n>       pass over the best n sessions, to read the next page
        --project <text>   only sessions whose folder contains the text
        --kind <kind>      user, assistant, thinking, error, cmd, edit, summary, call or result; repeatable
        --since <span>     only the last span, such as 12h, 30d or 2w
        --exclude <id>     leave one session out, usually the current one
        --own <id>         the session asking: read its new turns first, and
                           search it up to the turn in progress
        --keyword          match on words only; do not call the embedding server
        --best             list the best match first, not the newest
        --json             print the result as JSON
  lookback show <session id> [--offset <n>] [--limit <n>] [--kind <kind>] [--json]
      Read one session in order. The start of an id is enough.
  lookback recent [--project <folder>] [--exact] [--titled] [--limit <n>] [--exclude <id>] [--json]
      The latest sessions, newest first, each with its title and how it ended.
      --project takes a full folder path and covers the folders under it;
      --exact covers that folder only. --titled leaves out sessions with no
      title, which are mostly ones another session drove.
  lookback recall <prompt...> [--project <folder>] [--exclude <id>] [--skip <ids>]
      What past sessions of one folder already said about a prompt, or nothing.
      Only an entry that means nearly the same and shares two telling words
      counts. --skip takes session ids by commas, ones already shown.
  lookback recall --asked --session <id> <prompt...>
      What past turns say about a prompt that asks about earlier work. Reads
      the new turns of that session first, and searches them too, up to its
      last exchange. The words of that exchange name the topic, and an entry
      must hold three topic words to be printed.
  lookback fix <error text...> [--limit <n>] [--project <text>] [--since <span>] [--exclude <id>] [--brief] [--json]
      Past sessions that hit the same error, with what each ran or changed and how that turn ended.
  lookback how <words...> [--limit <n>] [--project <text>] [--since <span>] [--json]
      The shell commands that hold every word, the most run first.
  lookback blame [--brief [--min <n>] [--exclude <id>]] [--project <folder>] <file path> [--reads] [--limit <n>] [--json]
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
      Check the index, the transcripts, the embedding server and image captions.

Settings come from the environment: LOOKBACK_PROJECTS, LOOKBACK_DB,
LOOKBACK_EMBEDDING_URL, LOOKBACK_EMBEDDING_MODEL, LOOKBACK_EMBEDDING_KEY,
LOOKBACK_FILE_TOOLS (MCP tools or servers whose calls name files, by commas),
LOOKBACK_CAPTION_SERVER (a llama-server command that captions pasted images),
LOOKBACK_CAPTION_MODEL, LOOKBACK_CAPTION_URL, LOOKBACK_CAPTION_KEY (a running
server's vision model instead),
LOOKBACK_SQLITE_LIB (a libsqlite3 to use in place of Bun's; macOS needs one).

Exit codes: 0 ok, 1 failed, 2 bad usage, 3 no index yet.
`
