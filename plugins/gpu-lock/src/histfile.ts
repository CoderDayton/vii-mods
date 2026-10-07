import type { Sample } from '../types'
import { MIN_GAP_MS, parseSamples, sampleLine } from './history'
import { dirOf } from './lock'
import type { Sys } from './sys'

export { MIN_GAP_MS } from './history'
export const HISTORY_TRIM_AT = 500
export const HISTORY_KEEP = 400

const TIMEOUT_MS = 5000

export const historyPathOf = (lockPath: string): string => `${dirOf(lockPath)}/history.jsonl`

// Sessions share one file. A sample goes in under a lock, and only when the newest line is old enough,
// so any number of sessions polling at once leave about one sample per gap. Cutting the file in place
// keeps its owner and mode, so every user can go on appending.
const APPEND = `f=$1
at=$2
line=$3
case $at in ''|*[!0-9]*) exit 3 ;; esac
d=$(dirname "$f")
exec 9>>"$d/history.lock" || exit 3
flock -w 2 9 || exit 3
last=$(tail -n 1 "$f" 2>/dev/null | sed -n 's/^{"at":\\([0-9][0-9]*\\).*/\\1/p')
if [ -n "$last" ] && [ "$at" -ge "$last" ] && [ $((at - last)) -lt ${MIN_GAP_MS} ]; then exit 0; fi
printf '%s\\n' "$line" >> "$f" || exit 3
n=$(wc -l < "$f")
if [ "$n" -gt ${HISTORY_TRIM_AT} ]; then
  tail -n ${HISTORY_KEEP} "$f" > "$f.tmp" && cat "$f.tmp" > "$f"
  rm -f "$f.tmp"
fi
exit 0`

export const appendArgv = (lockPath: string, line: string, at: number): string[] => [
  'sh',
  '-c',
  APPEND,
  'gpu-lock-history',
  historyPathOf(lockPath),
  String(Math.floor(at)),
  line,
]

export const appendSample = async (sys: Sys, lockPath: string, sample: Sample): Promise<boolean> => {
  try {
    const r = await sys.process.run(appendArgv(lockPath, sampleLine(sample), sample.at), { timeoutMs: TIMEOUT_MS })
    return r.exitCode === 0
  } catch {
    return false
  }
}

export const readSamples = async (sys: Sys, lockPath: string, now: number): Promise<Sample[]> => {
  try {
    return parseSamples(await sys.fs.read(historyPathOf(lockPath)), now)
  } catch {
    return []
  }
}
