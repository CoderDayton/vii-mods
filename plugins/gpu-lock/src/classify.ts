import { scan } from './shell'
import type { Segment } from './shell'

export type Patterns = {
  extra: readonly RegExp[]
  skip: readonly RegExp[]
  lockPath?: string
}

export type Verdict =
  | { gpu: false }
  | { gpu: true; why: string; needMiB: number | null; devices: number[] | null }

const MAX_HEAD = 20000

const HINTS = [
  'cuda', 'cudnn', 'gpu', 'torch', 'pytorch', 'tensorflow', 'jax', 'triton', 'tensorrt', 'onnxruntime', 'vllm',
  'transformers', 'diffusers', 'bitsandbytes', 'flash-attn', 'flash_attn', 'xformers', 'cupy', 'numba', 'nccl',
  'nvenc', 'nvdec', 'cuvid',
]
const CARGO_HINTS = ['cuda', 'cudarc', 'gpu', 'candle', 'wgpu', 'torch', 'tch', 'onnx', 'ort', 'tensorrt', 'burn']

const wordRegex = (word: string): RegExp => new RegExp(`(?<![a-z])${word.replace(/[-_]/g, '\\$&')}(?![a-z])`, 'i')
const HINT_TESTS = HINTS.map(w => [w, wordRegex(w)] as const)
const CARGO_TESTS = CARGO_HINTS.map(w => [w, wordRegex(w)] as const)

const firstHint = (tests: readonly (readonly [string, RegExp])[], text: string): string | null =>
  tests.find(([, re]) => re.test(text))?.[0] ?? null
const SCRIPT = /(?<![a-z])((?:train|finetune|fine_tune|infer|inference|bench)\w*\.py)/i
const CARGO_JOB = /(?<![a-z])(train|finetune|infer|inference|bench|benchmark)\w*/i
const STRONG = /(--device[ =]cuda|cuda:\d|--gpus|CUDA_VISIBLE_DEVICES)/
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/
const NEED = /^(\d+(?:\.\d+)?)\s*(g|gb|gib|m|mb|mib)?$/i

const EXEMPT = new Set([
  'nvidia-smi', 'nvtop', 'gpustat', 'rg', 'rkgrep', 'grep', 'egrep', 'fgrep', 'cat', 'ls', 'head', 'tail', 'less',
  'more', 'git', 'gh', 'sed', 'awk', 'echo', 'printf', 'wc', 'find', 'fd', 'cp', 'mv', 'rm', 'mkdir', 'rmdir',
  'touch', 'chmod', 'chown', 'cd', 'pwd', 'which', 'whereis', 'type', 'jq', 'sqlite3', 'curl', 'wget', 'tar',
  'unzip', 'zip', 'gzip', 'diff', 'sort', 'uniq', 'tr', 'cut', 'tee', 'kill', 'pkill', 'killall', 'ps', 'pgrep',
  'lsof', 'fuser', 'df', 'du', 'free', 'top', 'htop', 'sleep', 'date', 'export', 'source', 'true', 'false', 'test',
  '[', 'ssh', 'scp', 'rsync', 'stat', 'file', 'ln', 'realpath', 'basename', 'dirname', 'tree', 'bat', 'code',
  'pip', 'npm', 'pnpm', 'yarn', 'apt', 'apt-get', 'brew', 'dpkg', 'uv', 'poetry', 'pipenv', 'pdm', 'rye', 'hatch',
  'conda', 'mamba', 'micromamba', 'claude', 'man', 'help', 'nproc', 'uname', 'whoami', 'id', 'env', 'ulimit', 'xdg-open',
])

const ALWAYS = new Set([
  'torchrun', 'deepspeed', 'vllm', 'llama-server', 'llama-cli', 'llama-bench', 'llama-perplexity', 'ncu', 'nsys',
  'trtexec',
])

const INTERPRETERS = new Set(['python', 'pytest', 'py.test', 'ipython', 'jupyter', 'node', 'bun', 'deno', 'julia', 'ffmpeg'])

const PIP_LIKE = new Set(['pip', 'venv', 'ensurepip', 'build', 'http.server', 'json.tool'])

const CARGO_RUN = new Set(['run', 'r', 'test', 't', 'bench', 'nextest'])

const RUNNERS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'rye', 'hatch', 'conda', 'mamba', 'micromamba'])
const RUNNER_VALUED = new Set(['-n', '-p', '--with', '--python', '--project', '--directory', '--env-file', '--group', '--extra', '--name', '--prefix'])

const skipFlags = (words: readonly string[], from: number, valued: ReadonlySet<string>): number => {
  let i = from
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    i += valued.has(words[i] ?? '') ? 2 : 1
  }
  return i
}

const NO_VALUE: ReadonlySet<string> = new Set()

const WRAPPERS = new Map<string, (words: readonly string[], from: number) => number>([
  ['sudo', (w, i) => skipFlags(w, i, new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']))],
  ['nohup', (_w, i) => i],
  ['time', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['command', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['exec', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['setsid', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['env', (w, i) => skipFlags(w, i, new Set(['-u', '-C', '-S']))],
  ['nice', (w, i) => skipFlags(w, i, new Set(['-n']))],
  ['ionice', (w, i) => skipFlags(w, i, new Set(['-c', '-n', '-p']))],
  ['stdbuf', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['npx', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['bunx', (w, i) => skipFlags(w, i, NO_VALUE)],
  ['timeout', (w, i) => skipFlags(w, i, new Set(['-s', '-k'])) + 1],
])

type Unwrapped = { env: Record<string, string>; program: string | undefined; args: string[] }

const baseName = (word: string): string => {
  const name = (word.split('/').pop() ?? '').toLowerCase()
  if (/^python[\d.]*$/.test(name)) return 'python'
  if (/^pip[\d.]*$/.test(name)) return 'pip'
  return name
}

const unwrap = (words: readonly string[]): Unwrapped => {
  const env: Record<string, string> = {}
  let i = 0
  while (i < words.length) {
    const word = words[i] ?? ''
    const assigned = ASSIGN.exec(word)
    if (assigned !== null) {
      env[assigned[1] ?? ''] = assigned[2] ?? ''
      i += 1
      continue
    }
    const base = baseName(word)
    const wrap = WRAPPERS.get(base)
    if (wrap !== undefined) {
      i = wrap(words, i + 1)
      continue
    }
    const next = words[i + 1]
    if (RUNNERS.has(base) && (next === 'run' || next === 'exec')) {
      i = skipFlags(words, i + 2, RUNNER_VALUED)
      continue
    }
    return { env, program: word, args: words.slice(i + 1) }
  }
  return { env, program: undefined, args: [] }
}

const parseNeed = (text: string): number | null => {
  const m = NEED.exec(text.trim())
  if (m === null) return null
  const n = Number(m[1])
  const unit = (m[2] ?? 'm').toLowerCase()
  return Math.round(unit.startsWith('g') ? n * 1024 : n)
}

const parseDevices = (value: string): number[] | null => {
  const ids = value.split(',').map(s => s.trim())
  const nums = ids.filter(s => /^\d+$/.test(s)).map(Number)
  return nums.length > 0 && nums.length === ids.length ? nums : null
}

type Hit = { why: string; devices: number[] | null }

const devicesOf = (env: Record<string, string>, text: string): number[] | null => {
  const fromEnv = env['CUDA_VISIBLE_DEVICES']
  if (fromEnv !== undefined) return parseDevices(fromEnv)
  const m = /cuda:(\d+)/.exec(text)
  return m === null ? null : [Number(m[1])]
}

const isCpuOnly = (value: string): boolean => value.trim() === '' || value.trim() === '-1' || value.trim() === 'NoDevFiles'

const judge = (segment: Segment): Hit | null => {
  const { env, program, args } = unwrap(segment.words)
  if (program === undefined) return null
  const base = baseName(program)
  const text = segment.text
  const visible = env['CUDA_VISIBLE_DEVICES']
  if (visible !== undefined && isCpuOnly(visible)) return null
  if (visible !== undefined && !EXEMPT.has(base)) return { why: 'CUDA_VISIBLE_DEVICES', devices: parseDevices(visible) }
  if (EXEMPT.has(base)) return null
  const devices = devicesOf(env, text)

  if (ALWAYS.has(base)) return { why: base, devices }
  if (base === 'accelerate') return args.includes('launch') ? { why: 'accelerate launch', devices } : null
  if (base === 'ollama') {
    const sub = args[0]
    return sub === 'run' || sub === 'serve' ? { why: `ollama ${sub}`, devices } : null
  }
  if (base === 'docker' || base === 'podman') {
    return /--gpus|--runtime[ =]nvidia/.test(text) ? { why: `${base} + gpus`, devices } : null
  }
  if (base === 'cargo') {
    const sub = args.find(a => !a.startsWith('-') && !a.startsWith('+'))
    if (sub === undefined || !CARGO_RUN.has(sub)) return null
    const hint = firstHint(CARGO_TESTS, text) ?? CARGO_JOB.exec(text)?.[1]?.toLowerCase() ?? null
    return hint === null ? null : { why: `cargo + ${hint}`, devices }
  }
  if (INTERPRETERS.has(base)) {
    if (base === 'python' && args[0] === '-m' && PIP_LIKE.has(args[1] ?? '')) return null
    const hint = firstHint(HINT_TESTS, text)
    if (hint !== null) return { why: `${base} + ${hint}`, devices }
    const script = SCRIPT.exec(text)
    return script === null ? null : { why: `${base} + ${(script[1] ?? '').toLowerCase()}`, devices }
  }
  const strong = STRONG.exec(text)
  return strong === null ? null : { why: `${base} + ${strong[1] ?? ''}`, devices }
}

type Marker = { kind: 'none' } | { kind: 'skip' } | { kind: 'force'; needMiB: number | null }

const markerOf = (comments: readonly string[]): Marker => {
  let found: Marker = { kind: 'none' }
  for (const comment of comments) {
    if (/^nogpu\b/i.test(comment)) return { kind: 'skip' }
    const m = /^gpu\b\s*(.*)$/i.exec(comment)
    if (m !== null) found = { kind: 'force', needMiB: parseNeed(m[1] ?? '') }
  }
  return found
}

export const compilePatterns = (text: string): { regexes: RegExp[]; bad: string[] } => {
  const regexes: RegExp[] = []
  const bad: string[] = []
  for (const line of text.split('\n').map(l => l.trim()).filter(l => l !== '')) {
    try {
      regexes.push(new RegExp(line, 'i'))
    } catch {
      bad.push(line)
    }
  }
  return { regexes, bad }
}

export const classify = (command: string, patterns: Patterns): Verdict => {
  const head = command.slice(0, MAX_HEAD)
  if (head.trim() === '') return { gpu: false }
  if (patterns.lockPath !== undefined && patterns.lockPath !== '' && head.includes(patterns.lockPath)) {
    return { gpu: false }
  }
  const { segments, comments } = scan(head)
  const marker = markerOf(comments)
  if (marker.kind === 'skip') return { gpu: false }
  if (patterns.skip.some(r => r.test(head))) return { gpu: false }

  const needMiB = marker.kind === 'force' ? marker.needMiB : null
  for (const segment of segments) {
    const hit = judge(segment)
    if (hit !== null) return { gpu: true, why: hit.why, needMiB, devices: hit.devices }
  }
  if (marker.kind === 'force') {
    const first = segments.map(s => unwrap(s.words).env).find(e => e['CUDA_VISIBLE_DEVICES'] !== undefined)
    return { gpu: true, why: 'marker # gpu', needMiB, devices: devicesOf(first ?? {}, head) }
  }
  if (patterns.extra.some(r => r.test(head))) return { gpu: true, why: 'extra pattern', needMiB, devices: null }
  return { gpu: false }
}
