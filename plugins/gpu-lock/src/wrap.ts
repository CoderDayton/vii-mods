import { clean } from './format'
import { quote } from './shell'

export type OwnerInfo = {
  session: string
  agent: string | null
  cmd: string
  cwd: string
  why: string
  needMiB: number | null
}

export type WrapSpec = {
  lockPath: string
  ownerPath: string
  waitSeconds: number
  owner: OwnerInfo
}

const FD = 9
const GRACE_SECONDS = 2
const LOST_EXIT = 75

export const wrap = (command: string, spec: WrapSpec): string => {
  const wait = Math.max(0, Math.floor(spec.waitSeconds))
  const acquire =
    wait === 0
      ? `flock -w ${GRACE_SECONDS} ${FD}`
      : `flock -n ${FD} || { printf '%s\\n' 'gpu-lock: waiting for the GPU lock (up to ${wait}s)' >&2; flock -w ${wait} ${FD}; }`
  const json = JSON.stringify({ ...spec.owner, cmd: clean(spec.owner.cmd, 200) })
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
