# gpu-lock

One CUDA job at a time. A Bash command that uses the GPU runs under a `flock`
lock and is checked against free GPU memory first. A second job is refused
with a message that names who holds the GPU and for how long.

## How it works

1. Each Bash call is classified: GPU job or not (see Markers below).
2. A GPU job reads the lock (never takes it) and `nvidia-smi`.
3. Lock held: the call is refused, or queued if `waitSeconds` is set.
4. Not enough free memory: the call is refused and says who is using it.
5. Otherwise the command is wrapped so it holds the lock until it exits. The
   wrapper writes who holds it to `owner.json` beside the lock file.

A lock held by a killed process frees itself. A background `&` child does not
hold the lock; the command you ran does.

## Markers

End a command with a comment to steer the classifier:

| Marker | Meaning |
| --- | --- |
| `# gpu` | This is a GPU job |
| `# gpu 8g` | GPU job that needs 8 GiB (`512m`, `1.5GiB`, `6000` MiB also work) |
| `# nogpu` | Not a GPU job |

A declared need replaces `minFreeMiB`, higher or lower. `CUDA_VISIBLE_DEVICES=`
(empty or `-1`) counts as CPU only.

## Commands

| Command | What it does |
| --- | --- |
| `/gpu` | Opens the pane, or closes it if it is open. The pane also has a Close button (`c`), and Escape closes it |
| `/gpu close` | Closes the pane |
| `/gpu status` | Prints lock and GPU state |
| `/gpu on`, `/gpu off` | Turns the lock on or off (remembered across sessions) |
| `/gpu check <command>` | Says whether a command counts as a GPU job. Runs nothing |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `waitSeconds` | `0` | Queue behind a held lock this long instead of refusing (0 to 600) |
| `minFreeMiB` | `1024` | Free memory a GPU job needs |
| `band` | `auto` | `auto` shows the band while locked, `always` also when free, `never` uses the status line |
| `extraPatterns` | empty | Extra regexes, one per line, that mark a command as a GPU job |
| `skipPatterns` | empty | Regexes that mark a command as not a GPU job |
| `lockPath` | `/tmp/gpu-lock/lock` | Absolute path of the lock file |

## Use the lock from a shell

```
flock /tmp/gpu-lock/lock python train.py
```

Anything that takes the same lock waits behind, or is refused by, this mod.

## Limits

- Linux with `flock` and `/proc/locks`. Without `flock` the mod passes
  commands through and tells you once.
- Classification is by command text. A script that uses the GPU behind a
  generic name needs `# gpu`, or an `extraPatterns` entry.
- Owner details come from a file any process can write. They are cleaned and
  clipped before display, and the owner pid is checked for life.
- `nvidia-smi` errors do not block a job; the lock still decides.
