# vii-mods

A Claude Code plugin marketplace.

## Plugins

| Plugin | What it does |
|---|---|
| [`rescribe`](plugins/rescribe/README.md) | Prompt enhancer: a shortcut rewrites the draft in the prompt box, and a menu shows the change to apply or dismiss. |
| [`gpu-lock`](plugins/gpu-lock/README.md) | One CUDA job at a time: GPU commands run under a lock and are checked against free GPU memory first. |

## Install

```
claude plugin marketplace add /home/vii/claude-mods
claude plugin install rescribe@vii-mods
claude plugin install gpu-lock@vii-mods
```

## Remove

```
claude plugin uninstall rescribe@vii-mods
claude plugin uninstall gpu-lock@vii-mods
claude plugin marketplace remove vii-mods
```
