# vii-mods

A Claude Code plugin marketplace.

## Plugins

| Plugin | What it does |
|---|---|
| [`rescribe`](plugins/rescribe/README.md) | Prompt enhancer: a shortcut rewrites the draft in the prompt box, and a menu shows the change to apply or dismiss. |
| [`gpu-lock`](plugins/gpu-lock/README.md) | One CUDA job at a time: GPU commands run under a lock and are checked against free GPU memory first. |
| [`correction-ledger`](plugins/correction-ledger/README.md) | Saves each correction you make as a standing rule, feeds the rules back every turn, and makes a rule louder each time it is broken. |
| [`fleet-board`](plugins/fleet-board/README.md) | A pane for the other Claude sessions you run: who is working, who went quiet. Brief, ping, task or stop them, and open new sessions from the pane. |
| [`lookback`](plugins/lookback/README.md) | Searches your past Claude Code sessions by words and by meaning, with a local SQLite index and Ollama embeddings. A tool for Claude, a `/lookback` command, and recall beside prompts that ask about earlier work. |
| [`smart-comments`](plugins/smart-comments/README.md) | Reads each comment Claude adds, lets through the ones that tell a reader what the code cannot, skips docstrings, and names the lines to cut. |
| [`cues`](plugins/cues/README.md) | Sound for Claude Code on Linux: mechanical key sounds as you type, and a chime when you send a prompt, when the reply lands and when a turn fails. |

## Install

```
claude plugin marketplace add /home/vii/claude-mods
claude plugin install rescribe@vii-mods
claude plugin install gpu-lock@vii-mods
claude plugin install correction-ledger@vii-mods
claude plugin install fleet-board@vii-mods
claude plugin install lookback@vii-mods
claude plugin install smart-comments@vii-mods
claude plugin install cues@vii-mods
```

## Development

Git hooks come from [lefthook](https://lefthook.dev). After cloning, run:

```
lefthook install
```

Each commit validates and tests the plugins it touches, and checks the subject is `type(scope): summary`.

## Remove

```
claude plugin uninstall rescribe@vii-mods
claude plugin uninstall gpu-lock@vii-mods
claude plugin uninstall correction-ledger@vii-mods
claude plugin uninstall fleet-board@vii-mods
claude plugin uninstall lookback@vii-mods
claude plugin uninstall smart-comments@vii-mods
claude plugin uninstall cues@vii-mods
claude plugin marketplace remove vii-mods
```
