# smart-comments

Claude writes more comments than a reader needs. This mod reads each comment Claude adds, lets through the ones that tell a reader something the code cannot, leaves docstrings alone, and tells Claude which lines to take out.

## The idea

A line count cannot tell a good comment from a bad one. This mod charges a comment for what it adds:

| Kind | What it is | Cost |
| --- | --- | --- |
| keep | A measured figure, a pitfall, a rule that must hold, a reason, a link, or a tool directive | Nothing |
| plain | Says something the code does not, but nothing a reader must know | 1 each, against a limit of 3, or more for a big edit |
| noise | Repeats the code under it, or tells the story of the edit | Trips the check alone |
| doc | A docstring right on a declaration | Skipped |

Claude is told which lines to delete and why:

```text
smart-comments: 3 new comment lines in src/a.ts; L3 is fine.
Delete or rewrite L1 (repeats the code), L5 (tells the edit story).
A comment should say what the code cannot: a figure, a pitfall or a rule. Docstrings are fine.
```

## How a comment is judged

The first test that fits decides.

1. A tool directive, a shebang or a licence line is kept.
2. History words ("now uses", "previously", "refactored") make it noise.
3. It repeats the code when at most a third of its words are new. The words of the comment, without filler words and empty verbs such as "get" and "check", are compared with the words of the code it sits on: the same line for a trailing comment, else the next two code lines. Names are split, so `userCache` gives "user" and "cache".
4. A measured figure, a rule word ("must", "never", "because"), a phrase that gives the reason ("so that", "to avoid", "in case", "by the time"), a consequence ("so the text is exact"), a return or exit contract ("or null when", "Exit 4", "$1 is", "Arguments:"), a unit ("1-based", "in bytes"), or a link keeps it.
5. Anything else is plain.

Test 3 runs before test 4, so "ensure user is not null" over `if (user !== null)` is noise in spite of its rule word. A line that carries on a kept sentence is kept too.

There is no model call. Every test is text matching.

## The limit

An edit may add `maxPlain` plain comment lines, or one for each twenty lines of new code when that is more. So a 10-line edit may add 3, and a 200-line file may add 10. A limit of 0 stays 0.

## When it looks

- **Each file edit.** The file is read before the call and after it. A comment in the new text that the old text did not have is new; a comment that only moved is not. If the new comments fail, a note reaches Claude with the tool result. The edit is never blocked.
- **A crowded stretch.** When an edit adds a plain comment and more than four in ten of the lines within ten lines of it are comments that add little, the note says so.
- **When Claude stops.** Each file Claude wrote since your prompt is judged against its text from before the first write. If a file still fails, Claude gets one follow-up prompt that names the lines. The turn that follow-up starts is never sent back itself, so it cannot loop.
- **Shell edits.** A file changed by a shell command (`sed -i`, a heredoc) is checked when Claude stops, not at the edit. It counts only when all three hold: git shows it as changed, it was clean when your prompt arrived, and a shell command of the turn names it. So your own edits, and files a generator or formatter wrote, are left alone. A new file that a `cp`, `mv`, `rsync` or `ln` put in place is left alone too: it came with its comments.

`Write`, `Edit` and `MultiEdit` are watched, and so are MCP tools named `write`, `edit`, `batch_edit` or `append` that take a `path` or `file_path`.

## Docstrings

Allowed by default. A fixed rule decides what one is:

- **JS, TS, Java and kin:** a `/** */` block with a declaration on the very next line.
- **C and C++:** a `/** */`, `/*! */` or `///` block with a function, type, macro or top-level variable on the very next line.
- **Rust:** `///` lines with an item or attribute on the next line, and `//!` lines anywhere.
- **Go:** a `//` run right above a `func`, `type`, `var` or `const`, starting with its name.
- **Python:** a triple-quoted docstring is a string, not a comment, so it is never read.

A `/** */` block over a plain statement, over a local `const`, or with a blank line under it is not a docstring. It is judged like any other comment.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `maxPlain` | 3 | Plain comment lines an edit, or a file over one turn, may add. 0 to 20. |
| `allowDocstrings` | on | Off, a docstring is judged like any other comment. |
| `noComments` | off | On, every new comment is flagged, docstrings too, and Claude is asked to delete it. Tool directives, shebangs and licence lines stay. `maxPlain` and `allowDocstrings` have no effect. |
| `notify` | off | On, a toast tells you when the mod flags comments in an edit or sends Claude back at the end of a turn. |

## Files it reads

- `//` and `/* */`: C, C++, TS, JS, Rust, Go, Java, Kotlin, Swift, C#, PHP, Scala, Dart, Zig.
- `#`: TOML, YAML, Python, shell, Ruby, Perl, R, Elixir, Nix.
- `--`: Lua, SQL, Haskell.

Other files are skipped. So are files of installed skills and plugins (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/plugins`). When a folder there is a link into a repo you work in, the real file is read.

## Limits

- It is a word test, not a reader. A comment that repeats the code in other words ("fetch the person" over `loadUser`) reads as plain, not noise.
- Shell edits are seen only inside a git repository, and only for files a command names. A file edited by a script the command runs is not seen.
- A trailing comment needs a space on each side of its marker. A marker inside a string is told apart by counting quotes, which a string with an escaped quote can fool.
- In TOML and YAML a `#` line inside a multi-line string is read as a comment.
- In C and C++ a local line that looks like a declaration (`Foo bar(1, 2);`) lets a fake docstring through.
- Files over 400,000 characters are not read.

## Install

```
claude plugin install smart-comments@vii-mods
```
