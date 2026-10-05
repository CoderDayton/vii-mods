# vii-mods

A Claude Code plugin marketplace.

## Plugins

| Plugin | What it does |
|---|---|
| [`dictation-repair`](plugins/dictation-repair/README.md) | Fixes speech-to-text mishearings in your prompt, using a dictionary that learns from your corrections. |

## Install

```
claude plugin marketplace add /home/vii/claude-mods
claude plugin install dictation-repair@vii-mods
```

## Remove

```
claude plugin uninstall dictation-repair@vii-mods
claude plugin marketplace remove vii-mods
```
