# gpu-lock

A Bash command that uses the GPU runs under a `flock` lock and is checked
against free GPU memory first. Two modes:

- `exclusive` (default): one GPU job at a time. A second job is refused with a
  message that names who holds the GPU and for how long.
- `shared`: several GPU jobs run together while their memory stays under a
  limit (`maxVramPercent`, 75% by default). A job that would pass the limit is
  refused, or queued if `waitSeconds` is set.

Either way the band, the pane and `/gpu status` show every running job and
every session waiting for a turn.

## How it works

1. Each Bash call is classified: GPU job or not (see Markers below).
2. A GPU job reads the lock (never takes it) and `nvidia-smi`.
3. Exclusive lock held: the call is refused, or queued if `waitSeconds` is set.
4. Not enough free memory (exclusive), or over the shared limit (shared): the
   call is refused and says who is using it.
5. Otherwise the command is wrapped so it holds the lock until it exits.
   Exclusive mode takes the lock exclusively and writes who holds it to
   `owner.json` beside the lock file. Shared mode checks the limit under a
   gate lock, writes a slot file in `jobs/`, and takes the lock *shared*.

A lock held by a killed process frees itself. A background `&` child does not
hold the lock; the command you ran does.

## Shared mode

- Limit: used memory plus the job's need must stay at or under
  `maxVramPercent` of the card. The need is `# gpu 8g` if given, else
  `minFreeMiB`.
- A job that started under 30 seconds ago may not have allocated yet, so its
  need counts as reserved until then.
- The first job on an idle card only has to fit in the free memory, so a job
  larger than the limit still runs alone.
- Admission is checked in one step under a gate lock, so two sessions cannot
  both take the last room.
- Jobs take the lock shared, so an exclusive user (`flock <file> <command>`,
  or a session in exclusive mode) waits for them, and shared jobs are refused
  while an exclusive job runs.
- Waiting sessions (`waitSeconds` set) write a file in `waiting/`, so every
  session sees the queue.

## The line

The wait queue is first in, first out, in both modes. A waiting job takes a
ticket (a timestamp in its file name) and may start only when no live waiter
holds an earlier ticket. The band and the pane number the line (`GPU waiting
#2`).

- A job that arrives while others wait does not skip the line. With
  `waitSeconds` set it joins the back; at 0 it is refused and told who is
  ahead.
- The line is strict. A small job that would fit waits behind a larger one
  that does not fit yet, so a big job is never starved.
- A waiter whose process died leaves the line at once.
- Exclusive-mode waiters poll once a second, shared-mode waiters every two.

## Markers

End a command with a comment to steer the classifier:

| Marker | Meaning |
| --- | --- |
| `# gpu` | This is a GPU job |
| `# gpu 8g` | GPU job that needs 8 GiB (`512m`, `1.5GiB`, `6000` MiB also work) |
| `# nogpu` | Not a GPU job |

A declared need replaces `minFreeMiB`, higher or lower. `CUDA_VISIBLE_DEVICES=`
(empty or `-1`) counts as CPU only.

## The memory chart

The pane draws GPU memory over the last 10 minutes, one chart per card. One
column is one slice of time and shows the fullest reading in it, in eighths of
a row. In shared mode a dashed line marks the limit.

Each column is stacked by job. A job gets a colour the first time it holds
memory and keeps it, and a legend names each running job with its memory.
Memory no job owns (a browser, a desktop app) is grey and listed as
`other processes`. A process counts for a job when its shell is in the job's
process tree (`ps -e -o pid=,ppid=`) and, with several cards, `nvidia-smi`
names the card it runs on.

Every session shares one history file, `history.jsonl` beside the lock file.
Each session adds a reading about every 3 seconds, and only when the newest
line is at least 2 seconds old, so many sessions leave one reading per gap. A
session that has just started shows the history the others wrote. The file is
cut back to its newest 400 lines once it passes 500. Lines that are not valid
readings are skipped.

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
| `mode` | `exclusive` | `exclusive` runs one GPU job at a time; `shared` lets several run under the memory limit |
| `maxVramPercent` | `75` | Shared mode: share of the card's memory all GPU jobs may use together (10 to 100) |
| `waitSeconds` | `0` | Queue behind a held lock, or behind the shared limit, this long instead of refusing (0 to 600) |
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
- Owner, slot, waiting and history files can be written by any process. They
  are cleaned and clipped before display, and slot pids are checked for life.
- A process that detaches from its job (a daemon, `setsid`) leaves the job's
  process tree and counts as `other processes`.
- Shared mode counts memory by what `nvidia-smi` shows plus the need of jobs
  under 30 seconds old. A job that grows past its need is not stopped.
- With several cards, a job's reserved need counts against every card it may
  use.
- `nvidia-smi` errors do not block a job; the lock still decides.
