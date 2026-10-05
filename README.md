# vii-mods

A Claude Code plugin marketplace.

## Plugins

| Plugin | What it does |
|---|---|
| [`dictation-repair`](plugins/dictation-repair/README.md) | Fixes speech-to-text mishearings in your prompt, using a dictionary that learns from your corrections. |
| [`gpu-lock`](plugins/gpu-lock/README.md) | One CUDA job at a time: GPU commands run under a lock and are checked against free GPU memory first. |

## Install

```
claude plugin marketplace add /home/vii/claude-mods
claude plugin install dictation-repair@vii-mods
claude plugin install gpu-lock@vii-mods
```

## Remove

```
claude plugin uninstall dictation-repair@vii-mods
claude plugin uninstall gpu-lock@vii-mods
claude plugin marketplace remove vii-mods
```
