import { expect, test } from 'claude-code/testing'

import { wrap } from '../src/wrap'
import type { WrapSpec } from '../src/wrap'

const spec = (extra: Partial<WrapSpec> = {}): WrapSpec => ({
  lockPath: '/tmp/gpu-lock/lock',
  ownerPath: '/tmp/gpu-lock/owner.json',
  waitingDir: '/tmp/gpu-lock/waiting',
  share: null,
  waitSeconds: 0,
  owner: { session: 's1', agent: null, cmd: 'python train.py', cwd: '/w', why: 'python + train.py', needMiB: null },
  ...extra,
})

test('takes the lock on fd 9 with a short grace wait, and closes the fd for the command', () => {
  const w = wrap('python train.py', spec())
  expect(w.includes('&& flock -w 2 9; then\n')).toBe(true)
  expect(w.endsWith("\nfi 9<'/tmp/gpu-lock/lock'\n(exit $?)")).toBe(true)
  expect(w.includes('\n{\npython train.py\n} 9>&-\n')).toBe(true)
})

test('puts the command on its own lines so a trailing comment cannot swallow the close', () => {
  const w = wrap('ls # gpu', spec())
  expect(w.includes('\n{\nls # gpu\n} 9>&-\n')).toBe(true)
})

test('a lost race prints a fixed message and exits 75 without the command', () => {
  const w = wrap('python train.py', spec())
  const after = w.slice(w.indexOf('\nelse\n'))
  expect(after.includes('exit 75')).toBe(true)
  expect(after.includes('python train.py')).toBe(false)
  expect(after.includes('another job took the GPU lock first')).toBe(true)
})

test('writes the owner file with the shell pid and the time', () => {
  const w = wrap('python train.py', spec())
  expect(w.includes('"$$"')).toBe(true)
  expect(w.includes('"$(date +%s)"')).toBe(true)
  expect(w.includes(">'/tmp/gpu-lock/owner.json'")).toBe(true)
  expect(w.includes('"session":"s1"')).toBe(true)
})

test('single quotes and shell syntax in the owner text stay inside the quoting', () => {
  const w = wrap("echo 'a' $(rm -rf /) `x`", spec({ owner: { ...spec().owner, cmd: "echo 'a' $(rm -rf /) `x`" } }))
  expect(w.includes("echo '\\''a'\\''")).toBe(true)
})

test('a waiting lock tries once, says it is waiting, then polls in line up to the limit', () => {
  const w = wrap('python train.py', spec({ waitSeconds: 30 }))
  expect(w.startsWith('if { sh -c ')).toBe(true)
  expect(w.includes('flock -n 9')).toBe(true)
  expect(w.includes('end=$((')).toBe(true)
  expect(w.includes('+ 30))')).toBe(true)
  expect(w.includes('waiting for the GPU lock (up to 30s)')).toBe(true)
  expect(w.includes('sleep 1')).toBe(true)
})

test('an exclusive job only takes the lock when nobody waits ahead of it', () => {
  const w = wrap('x', spec())
  expect(w.startsWith("if sh -c ")).toBe(true)
  expect(w.includes("gpu-lock-ahead '/tmp/gpu-lock/waiting' '' && flock -w 2 9; then")).toBe(true)
})

test('the wait is a whole number of seconds, never negative', () => {
  expect(wrap('x', spec({ waitSeconds: 2.9 })).includes('+ 2))')).toBe(true)
  expect(wrap('x', spec({ waitSeconds: -4 })).includes('flock -w 2 9')).toBe(true)
})

test('a queued exclusive job is listed in the waiting folder under a ticket, and leaves it when done', () => {
  const w = wrap('python train.py', spec({ waitSeconds: 30 }))
  expect(w.includes("q='/tmp/gpu-lock/waiting'/$(date +%s%N)-$$.json")).toBe(true)
  expect(w.includes('>"$q"')).toBe(true)
  expect(w.includes('rm -f "$q"')).toBe(true)
  expect(w.includes('"${q##*/}"')).toBe(true)
})

const share = { jobsDir: '/tmp/gpu-lock/jobs', gatePath: '/tmp/gpu-lock/gate', maxPercent: 75, needMiB: 4096, devices: null }

test('a shared job is admitted under the gate, then takes a shared lock on fd 9', () => {
  const w = wrap('python train.py', spec({ share }))
  expect(w.includes("gpu-lock-admit '/tmp/gpu-lock/jobs' '/tmp/gpu-lock/gate' \"$j\"")).toBe(true)
  expect(w.includes('"$$" 4096 75 ')).toBe(true)
  expect(w.includes("'/tmp/gpu-lock/waiting' ''; then")).toBe(true)
  expect(w.includes('flock -s -w 2 9')).toBe(true)
  expect(w.includes('\n{\npython train.py\n} 9>&-\n')).toBe(true)
  expect(w.endsWith("\nfi 9<'/tmp/gpu-lock/lock'\n(exit $?)")).toBe(true)
  expect(w.includes('exit 75')).toBe(true)
})

test('a shared job keeps its exit status and removes its slot', () => {
  const w = wrap('python train.py', spec({ share }))
  expect(w.includes('} 9>&-\ns=$?\nrm -f "$j"\n(exit $s)')).toBe(true)
  expect(w.includes('"$$-$t.json"') || w.includes("/jobs'/$$-$t.json") || w.includes("'/tmp/gpu-lock/jobs'/$$-$t.json")).toBe(true)
})

test('a shared job waits for memory only when a wait is set, and lists itself while it waits', () => {
  const none = wrap('x', spec({ share }))
  expect(none.includes('sleep')).toBe(false)
  expect(none.includes('>"$q"')).toBe(false)
  const queued = wrap('x', spec({ share, waitSeconds: 30 }))
  expect(queued.includes('waiting for GPU memory (up to 30s)')).toBe(true)
  expect(queued.includes('sleep 2')).toBe(true)
  expect(queued.includes('>"$q"')).toBe(true)
  expect(queued.includes('rm -f "$q"')).toBe(true)
  expect(queued.includes('"$q"; then admitted=1')).toBe(true)
})

test('a shared job passes the devices it names and clamps the cap', () => {
  const w = wrap('x', spec({ share: { ...share, devices: [0, 2], maxPercent: 250 } }))
  expect(w.includes(" 4096 100 '0,2'")).toBe(true)
})

test('a shared job records the need it was admitted with', () => {
  const w = wrap('x', spec({ share }))
  expect(w.includes('"needMiB":4096')).toBe(true)
})

test('the owner text is clipped, so a huge command cannot bloat the wrapper', () => {
  const big = 'x'.repeat(5000)
  const w = wrap(big, spec({ owner: { ...spec().owner, cmd: big } }))
  expect(w.includes('x'.repeat(201))).toBe(true)
  expect(w.indexOf('x'.repeat(201)) > w.indexOf('\n{\n')).toBe(true)
})
