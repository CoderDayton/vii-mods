import type { Holder, LockState } from '../types'
import { clean } from './format'
import { RAMP_SECONDS } from './share'

export const ownerPathOf = (lockPath: string): string => {
  const cut = lockPath.lastIndexOf('/')
  return `${cut < 0 ? '.' : lockPath.slice(0, cut) || ''}/owner.json`
}

export const dirOf = (lockPath: string): string => {
  const cut = lockPath.lastIndexOf('/')
  return cut < 0 ? '.' : lockPath.slice(0, cut) || ''
}

export const jobsDirOf = (lockPath: string): string => `${dirOf(lockPath)}/jobs`
export const waitingDirOf = (lockPath: string): string => `${dirOf(lockPath)}/waiting`
export const gateOf = (lockPath: string): string => `${dirOf(lockPath)}/gate`

// Exit 0: held exclusively. 1: free. 4: held only by shared holders. 3: could not tell.
// Stdout lists the live slot files, one per line: `jobs <json>` or `waiting <json>`.
// A slot whose pid is gone is skipped once it is older than the ramp, so a job that
// has just started is not dropped before its shell is visible.
const PROBE = `f=$1
d=$(dirname "$f")
list() {
  now=$(date +%s)
  for k in jobs waiting; do
    for p in "$d/$k"/*.json; do
      [ -f "$p" ] || continue
      b=$(head -c 2000 "$p" | tr '\\n\\r' '  ')
      pid=$(printf '%s' "$b" | sed -n 's/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p')
      since=$(printf '%s' "$b" | sed -n 's/.*"since": *\\([0-9][0-9]*\\).*/\\1/p')
      if [ -d /proc/self ] && [ -n "$pid" ] && [ ! -d "/proc/$pid" ] && [ $((now - \${since:-0})) -ge ${RAMP_SECONDS} ]; then continue; fi
      printf '%s %s\\n' "$k" "$b"
    done
  done
}
[ -e "$f" ] || exit 1
if [ -r /proc/locks ]; then
  dev=$(stat -c %d "$f" 2>/dev/null) || exit 3
  ino=$(stat -c %i "$f" 2>/dev/null) || exit 3
  awk -v d="$dev" -v i="$ino" '
    BEGIN { x = int(d / 4096); want = sprintf("%02x:%02x:%d", int(d / 256) % 4096, d % 256 + x - x % 256, i) }
    $2 == "FLOCK" && $0 !~ /->/ && $6 == want { if ($4 == "WRITE") w = 1; else r = 1 }
    END { exit w ? 0 : (r ? 4 : 1) }
  ' /proc/locks
  s=$?
else
  flock -w 1 -E 9 "$f" true
  case $? in 0) s=1 ;; 9) s=0 ;; *) s=3 ;; esac
fi
list
exit $s`

const ENSURE = `f=$1
d=$(dirname "$f")
mkdir -p -m 777 "$d" 2>/dev/null
for s in jobs waiting; do mkdir -p -m 777 "$d/$s" 2>/dev/null; done
[ -e "$f" ] || { : > "$f" && chmod 666 "$f"; } 2>/dev/null
for s in gate history.jsonl history.lock; do [ -e "$d/$s" ] || { : > "$d/$s" && chmod 666 "$d/$s"; } 2>/dev/null; done
[ -r "$f" ] || exit 3
command -v flock >/dev/null 2>&1 || exit 4
exit 0`

export const probeArgv = (lockPath: string): string[] => ['sh', '-c', PROBE, 'gpu-lock-probe', lockPath]

export const ensureArgv = (lockPath: string): string[] => ['sh', '-c', ENSURE, 'gpu-lock-ensure', lockPath]

export const ensureReason = (exitCode: number): string | null => {
  if (exitCode === 0) return null
  if (exitCode === 4) return 'flock is not installed'
  return 'the lock file cannot be created or read'
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? clean(v, max) : '')

export const parseHolder = (raw: string): Holder | null => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  const pid = o['pid']
  const since = o['since']
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null
  const need = o['needMiB']
  const agent = text(o['agent'], 64)
  return {
    session: text(o['session'], 64),
    agent: agent === '' ? null : agent,
    cmd: text(o['cmd'], 200),
    cwd: text(o['cwd'], 200),
    why: text(o['why'], 80),
    needMiB: typeof need === 'number' && Number.isFinite(need) && need > 0 ? need : null,
    pid,
    since: since * 1000,
  }
}

// State outlives a reload, so a stored snapshot may predate the waiters field.
export const waitersOf = (snap: { waiters?: Holder[] }): Holder[] => snap.waiters ?? []

export const parseListing = (stdout: string): { jobs: Holder[]; waiters: Holder[] } => {
  const jobs: Holder[] = []
  const waiters: Holder[] = []
  for (const line of stdout.split('\n')) {
    const cut = line.indexOf(' ')
    const kind = line.slice(0, cut)
    if (kind !== 'jobs' && kind !== 'waiting') continue
    const h = parseHolder(line.slice(cut + 1))
    if (h !== null) (kind === 'jobs' ? jobs : waiters).push(h)
  }
  return { jobs: jobs.sort((a, b) => a.since - b.since), waiters: waiters.sort((a, b) => a.since - b.since) }
}

export const lockState = (probeExit: number, ownerText: string | null, ownerAlive: boolean): LockState => {
  if (probeExit === 1) return { kind: 'free' }
  if (probeExit !== 0) return { kind: 'unavailable', reason: `the lock probe failed (exit ${probeExit})` }
  const holder = ownerText === null ? null : parseHolder(ownerText)
  return { kind: 'held', holder: holder !== null && ownerAlive ? holder : null }
}
