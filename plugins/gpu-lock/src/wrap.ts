import { clean } from './format'
import { RAMP_SECONDS } from './share'
import { quote } from './shell'

export type OwnerInfo = {
  session: string
  agent: string | null
  cmd: string
  cwd: string
  why: string
  needMiB: number | null
}

export type ShareSpec = {
  jobsDir: string
  gatePath: string
  maxPercent: number
  needMiB: number
  devices: number[] | null
}

export type WrapSpec = {
  lockPath: string
  ownerPath: string
  waitingDir: string
  waitSeconds: number
  owner: OwnerInfo
  share: ShareSpec | null
}

const FD = 9
const GRACE_SECONDS = 2
const LOST_EXIT = 75
const POLL_SECONDS = 2

// The line is first in, first out. A waiting job writes a file named by a nanosecond ticket,
// so names sort in arrival order. A job may start only when no live waiter sorts before its
// own file; a job that is not queued yet has no file, so every live waiter is ahead of it.
// Arguments: waiting dir, name of the caller's own file ('' if it has none). Returns 0 if blocked.
const BLOCKED = `blocked() {
  for bf in "$1"/*.json; do
    [ -f "$bf" ] || continue
    [ "\${bf##*/}" = "$2" ] && return 1
    bb=$(head -c 2000 "$bf" | tr '\\n\\r' '  ')
    bp=$(printf '%s' "$bb" | sed -n 's/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p')
    [ -n "$bp" ] || continue
    if [ -d /proc/self ] && [ ! -d "/proc/$bp" ]; then continue; fi
    return 0
  done
  return 1
}`

// Exit 0: nobody waits ahead of the caller. Arguments: waiting dir, the caller's file name.
const AHEAD = `LC_ALL=C
export LC_ALL
${BLOCKED}
blocked "$1" "$2" && exit 1
exit 0`

// Runs under `sh -c`, never the user's shell, so globbing and word splitting are fixed.
// Arguments: jobs dir, gate file, job file, job json without its closing brace, pid, need MiB,
// cap percent, comma-separated devices, waiting dir, the caller's waiting file ('' if none).
// Exit 0 and a written job file mean admitted; 1 means not. An admitted job leaves the line.
// The gate makes the check and the write one step across sessions. A slot younger than the
// ramp reserves its need, since its memory may not show in nvidia-smi yet.
const ADMIT = `jobs=$1 gate=$2 job=$3 json=$4 pid=$5 need=$6 pct=$7 devs=$8
shift 8
wdir=$1 q=$2
LC_ALL=C
export LC_ALL
${BLOCKED}
exec 8>>"$gate"
flock -w 5 8 || :
if blocked "$wdir" "\${q##*/}"; then exit 1; fi
now=$(date +%s)
n=0
reserved=0
for f in "$jobs"/*.json; do
  [ -f "$f" ] || continue
  b=$(head -c 2000 "$f" | tr '\\n\\r' '  ')
  p=$(printf '%s' "$b" | sed -n 's/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p')
  s=$(printf '%s' "$b" | sed -n 's/.*"since": *\\([0-9][0-9]*\\).*/\\1/p')
  m=$(printf '%s' "$b" | sed -n 's/.*"needMiB": *\\([0-9][0-9]*\\).*/\\1/p')
  if [ $((now - \${s:-0})) -lt ${RAMP_SECONDS} ]; then
    reserved=$((reserved + \${m:-0}))
    n=$((n + 1))
    continue
  fi
  if [ -d /proc/self ] && [ -n "$p" ] && [ ! -d "/proc/$p" ]; then continue; fi
  n=$((n + 1))
done
smi=$(nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null) || smi=
if [ -n "$smi" ]; then
  printf '%s\\n' "$smi" | awk -F', *' -v need="$need" -v res="$reserved" -v n="$n" -v pct="$pct" -v devs="$devs" '
    { idx[NR] = $1; used[NR] = $2; tot[NR] = $3 }
    END {
      split(devs, dv, ","); for (k in dv) want[dv[k]] = 1
      any = 0; for (i = 1; i <= NR; i++) if (idx[i] in want) any = 1
      fit = 0
      for (i = 1; i <= NR; i++) {
        if (any && !(idx[i] in want)) continue
        if (n == 0) { if (tot[i] - used[i] >= need) fit = 1 }
        else if (used[i] + res + need <= tot[i] * pct / 100) fit = 1
      }
      exit fit ? 0 : 1
    }' || exit 1
fi
[ -n "$q" ] && rm -f "$q"
printf '%s,"pid":%s,"since":%s}\\n' "$json" "$pid" "$now" >"$job.tmp" && mv "$job.tmp" "$job"`

const ownerJson = (spec: WrapSpec): string => {
  const needMiB = spec.share === null ? spec.owner.needMiB : spec.share.needMiB
  return JSON.stringify({ ...spec.owner, needMiB, cmd: clean(spec.owner.cmd, 200) })
}

const wrapExclusive = (command: string, spec: WrapSpec, json: string): string => {
  const wait = Math.max(0, Math.floor(spec.waitSeconds))
  const ahead = (own: string) => `sh -c ${quote(AHEAD)} gpu-lock-ahead ${quote(spec.waitingDir)} ${own}`
  const acquire =
    wait === 0
      ? `${ahead("''")} && flock -w ${GRACE_SECONDS} ${FD}`
      : [
          `{ ${ahead("''")} && flock -n ${FD}; } || {`,
          `q=${quote(spec.waitingDir)}/$(date +%s%N)-$$.json;`,
          `printf '%s\\n' 'gpu-lock: waiting for the GPU lock (up to ${wait}s)' >&2;`,
          `printf '%s,"pid":%s,"since":%s}\\n' ${quote(json.slice(0, -1))} "$$" "$(date +%s)" >"$q";`,
          `end=$(($(date +%s) + ${wait})); got=1;`,
          `while [ "$(date +%s)" -lt "$end" ]; do sleep 1; if ${ahead('"${q##*/}"')} && flock -n ${FD}; then got=0; break; fi; done;`,
          'rm -f "$q"; (exit $got); }',
        ].join(' ')
  return [
    `if ${acquire}; then`,
    `printf '%s,"pid":%s,"since":%s}\\n' ${quote(json.slice(0, -1))} "$$" "$(date +%s)" >${quote(spec.ownerPath)}`,
    '{',
    command,
    `} ${FD}>&-`,
    'else',
    "printf '%s\\n' 'gpu-lock: another job took the GPU lock first, so this command did not run.' >&2",
    `(exit ${LOST_EXIT})`,
    `fi ${FD}<${quote(spec.lockPath)}`,
    '(exit $?)',
  ].join('\n')
}

// Shared mode: admission under the gate, then a shared flock so an exclusive user still excludes it.
const wrapShared = (command: string, spec: WrapSpec, share: ShareSpec, json: string): string => {
  const wait = Math.max(0, Math.floor(spec.waitSeconds))
  const head = json.slice(0, -1)
  const admit = (own: string) =>
    [
      'sh -c',
      quote(ADMIT),
      'gpu-lock-admit',
      quote(share.jobsDir),
      quote(share.gatePath),
      '"$j"',
      quote(head),
      '"$$"',
      String(Math.max(0, Math.floor(share.needMiB))),
      String(Math.min(100, Math.max(1, Math.floor(share.maxPercent)))),
      quote((share.devices ?? []).join(',')),
      quote(spec.waitingDir),
      own,
    ].join(' ')
  const lines = [
    't=$(date +%s)',
    `j=${quote(share.jobsDir)}/$$-$t.json`,
    'admitted=0',
    `if ${admit("''")}; then`,
    'admitted=1',
  ]
  if (wait > 0) {
    lines.push(
      'else',
      `q=${quote(spec.waitingDir)}/$(date +%s%N)-$$.json`,
      `printf '%s\\n' 'gpu-lock: waiting for GPU memory (up to ${wait}s)' >&2`,
      `printf '%s,"pid":%s,"since":%s}\\n' ${quote(head)} "$$" "$t" >"$q"`,
      `end=$((t + ${wait}))`,
      'while [ "$(date +%s)" -lt "$end" ]; do',
      `sleep ${POLL_SECONDS}`,
      `if ${admit('"$q"')}; then admitted=1; break; fi`,
      'done',
      'rm -f "$q"',
    )
  }
  lines.push(
    'fi',
    `if [ $admitted -eq 1 ] && flock -s -w ${GRACE_SECONDS} ${FD}; then`,
    '{',
    command,
    `} ${FD}>&-`,
    's=$?',
    'rm -f "$j"',
    '(exit $s)',
    'else',
    '[ $admitted -eq 1 ] && rm -f "$j"',
    wait > 0
      ? `printf '%s\\n' 'gpu-lock: another job took the GPU memory first, or it stayed over the limit for ${wait}s, so this command did not run.' >&2`
      : "printf '%s\\n' 'gpu-lock: another job took the GPU memory first, so this command did not run.' >&2",
    `(exit ${LOST_EXIT})`,
    `fi ${FD}<${quote(spec.lockPath)}`,
    '(exit $?)',
  )
  return lines.join('\n')
}

export const wrap = (command: string, spec: WrapSpec): string => {
  const json = ownerJson(spec)
  return spec.share === null ? wrapExclusive(command, spec, json) : wrapShared(command, spec, spec.share, json)
}
