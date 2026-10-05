# vii-mods

A Claude Code plugin marketplace.

## Plugins

| Plugin | What it does |
|---|---|
| [`prompt-repair`](plugins/prompt-repair/README.md) | Fixes your prompt before it is sent: misheard or wrong words, typos and self-corrections. Review the fix or run it automatically. |
| [`gpu-lock`](plugins/gpu-lock/README.md) | One CUDA job at a time: GPU commands run under a lock and are checked against free GPU memory first. |

## Install

```
claude plugin marketplace add /home/vii/claude-mods
claude plugin install prompt-repair@vii-mods
claude plugin install gpu-lock@vii-mods
```

## Remove

```
claude plugin uninstall prompt-repair@vii-mods
claude plugin uninstall gpu-lock@vii-mods
claude plugin marketplace remove vii-mods
```
