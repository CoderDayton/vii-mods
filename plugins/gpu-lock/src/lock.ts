import type { Holder, LockState } from '../types'
import { clean } from './format'

export const ownerPathOf = (lockPath: string): string => {
  const cut = lockPath.lastIndexOf('/')
  return `${cut < 0 ? '.' : lockPath.slice(0, cut) || ''}/owner.json`
}

const PROBE = `f=$1
[ -e "$f" ] || exit 1
if [ -r /proc/locks ]; then
  dev=$(stat -c %d "$f" 2>/dev/null) || exit 3
  ino=$(stat -c %i "$f" 2>/dev/null) || exit 3
  awk -v d="$dev" -v i="$ino" '
    BEGIN { x = int(d / 4096); want = sprintf("%02x:%02x:%d", int(d / 256) % 4096, d % 256 + x - x % 256, i) }
    $2 == "FLOCK" && $0 !~ /->/ && $6 == want { found = 1 }
    END { exit found ? 0 : 1 }
  ' /proc/locks
  exit $?
fi
flock -w 1 -E 9 "$f" true
case $? in 0) exit 1 ;; 9) exit 0 ;; *) exit 3 ;; esac`

const ENSURE = `f=$1
mkdir -p -m 777 "$(dirname "$f")" 2>/dev/null
[ -e "$f" ] || { : > "$f" && chmod 666 "$f"; } 2>/dev/null
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

export const lockState = (probeExit: number, ownerText: string | null, ownerAlive: boolean): LockState => {
  if (probeExit === 1) return { kind: 'free' }
  if (probeExit !== 0) return { kind: 'unavailable', reason: `the lock probe failed (exit ${probeExit})` }
  const holder = ownerText === null ? null : parseHolder(ownerText)
  return { kind: 'held', holder: holder !== null && ownerAlive ? holder : null }
}
