import { expect, test } from 'claude-code/testing'

import { classify, compilePatterns } from '../src/classify'

const none = { extra: [], skip: [] }

const gpuCommands: [string, string][] = [
  ['python train.py --device cuda', 'python + cuda'],
  ['CUDA_VISIBLE_DEVICES=0 python run.py', 'CUDA_VISIBLE_DEVICES'],
  ['cd /work && torchrun --nproc_per_node 2 main.py', 'torchrun'],
  ['uv run python -c "import torch; print(torch.cuda.is_available())"', 'python + cuda'],
  ['cargo run --release --features cuda', 'cargo + cuda'],
  ['cargo test --features cuda', 'cargo + cuda'],
  ['nohup python train.py > out.log 2>&1 &', 'python + train.py'],
  ['timeout 600 python scripts/bench_gpu.py', 'python + gpu'],
  ['llama-server -m model.gguf', 'llama-server'],
  ['ollama run llama3', 'ollama run'],
  ['ollama serve', 'ollama serve'],
  ['vllm serve some/model', 'vllm'],
  ['python - <<\'EOF\'\nimport torch\nprint(torch.zeros(1).cuda())\nEOF', 'python + cuda'],
  ['pytest tests/gpu -x', 'pytest + gpu'],
  ['docker run --rm --gpus all nvidia/cuda nvidia-smi', 'docker + gpus'],
  ['ffmpeg -hwaccel cuda -i in.mp4 out.mp4', 'ffmpeg + cuda'],
  ['rg cuda src/ && python train.py', 'python + train.py'],
  ['echo start; python scripts/benchmark.py', 'python + benchmark.py'],
  ['sudo -E python train.py', 'python + train.py'],
  ['accelerate launch train.py', 'accelerate launch'],
]

for (const [command, why] of gpuCommands) {
  test(`counts as a GPU job: ${command.split('\n')[0]}`, () => {
    const v = classify(command, none)
    expect(v.gpu).toBe(true)
    if (v.gpu) expect(v.why).toBe(why)
  })
}

const notGpu = [
  'nvidia-smi',
  'nvidia-smi --query-gpu=memory.used --format=csv',
  'sudo nvidia-smi -pl 300',
  'rg cuda src/',
  'grep -r torch .',
  'git commit -m "fix cuda path"',
  'cat train.py',
  'ls /usr/local/cuda',
  'echo "python train.py --device cuda"',
  'cargo build --release --features cuda',
  'cargo check --features cuda',
  'cargo clippy --features cuda',
  'python -m pip install torch',
  'pip install torch --index-url https://download.pytorch.org/whl/cu124',
  'uv pip install torch',
  'uv sync',
  'python script.py',
  'python -c "print(1)"',
  'python analyze.py',
  'tail -f train.log',
  'kill 4242',
  'CUDA_VISIBLE_DEVICES="" python train.py',
  'CUDA_VISIBLE_DEVICES=-1 python train.py',
  'python train.py # nogpu',
  'ls',
  '',
  '   ',
]

for (const command of notGpu) {
  test(`does not count as a GPU job: ${JSON.stringify(command)}`, () => {
    expect(classify(command, none).gpu).toBe(false)
  })
}

test('a # gpu marker forces the lock, even on a read-only program', () => {
  const v = classify('echo hi # gpu', none)
  expect(v.gpu).toBe(true)
  if (v.gpu) expect(v.why).toBe('marker # gpu')
})

test('a # nogpu marker wins over every other sign', () => {
  expect(classify('CUDA_VISIBLE_DEVICES=0 torchrun train.py # nogpu', none).gpu).toBe(false)
})

const needs: [string, number][] = [
  ['python train.py # gpu 8g', 8192],
  ['python train.py # gpu 8GB', 8192],
  ['python train.py # gpu 1.5 GiB', 1536],
  ['python train.py # gpu 512m', 512],
  ['python train.py # gpu 6000', 6000],
  ['python train.py # gpu 6000mib', 6000],
]

for (const [command, mib] of needs) {
  test(`reads the memory a job asks for: ${command}`, () => {
    const v = classify(command, none)
    expect(v.gpu).toBe(true)
    if (v.gpu) expect(v.needMiB).toBe(mib)
  })
}

test('a job that asks for nothing has no declared need', () => {
  const v = classify('python train.py', none)
  expect(v.gpu && v.needMiB).toBe(null)
})

test('reads the devices a job names', () => {
  const a = classify('CUDA_VISIBLE_DEVICES=1,2 python train.py', none)
  expect(a.gpu && a.devices).toEqual([1, 2])
  const b = classify('python train.py --device cuda:1', none)
  expect(b.gpu && b.devices).toEqual([1])
  const c = classify('python train.py', none)
  expect(c.gpu && c.devices).toBe(null)
})

test('a marker in a quoted string is not a marker', () => {
  expect(classify('echo "# gpu"', none).gpu).toBe(false)
})

test('a command that already uses the lock file is left alone', () => {
  const v = classify('flock /tmp/gpu-lock/lock python train.py', { ...none, lockPath: '/tmp/gpu-lock/lock' })
  expect(v.gpu).toBe(false)
})

test('extra patterns add GPU commands; skip patterns remove them', () => {
  const { regexes: extra } = compilePatterns('\\bmy-gpu-tool\\b')
  const { regexes: skip } = compilePatterns('^python tools/')
  expect(classify('my-gpu-tool --go', { extra, skip: [] }).gpu).toBe(true)
  expect(classify('python tools/train.py', { extra: [], skip }).gpu).toBe(false)
  expect(classify('python tools/train.py', none).gpu).toBe(true)
})

test('compilePatterns keeps good lines and reports the bad ones', () => {
  const r = compilePatterns('good\n\n  \n(unclosed\nalso good')
  expect(r.regexes.length).toBe(2)
  expect(r.bad).toEqual(['(unclosed'])
})

test('a very long command is judged on its head and stays fast', () => {
  const long = `python train.py ${'x '.repeat(200000)}`
  const t = Date.now()
  expect(classify(long, none).gpu).toBe(true)
  expect(Date.now() - t < 500).toBe(true)
})
