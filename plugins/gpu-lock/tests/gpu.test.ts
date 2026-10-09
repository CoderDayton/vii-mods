import { expect, test } from 'claude-code/testing'

import { headroom, parseApps, parseGpus, SMI_APPS, SMI_GPUS } from '../src/gpu'

test('parses the gpu query', () => {
  const gpus = parseGpus('0, NVIDIA GeForce RTX 4090, 5589, 24564, 3, 41\n')
  expect(gpus).toEqual([
    { index: 0, name: 'NVIDIA GeForce RTX 4090', usedMiB: 5589, totalMiB: 24564, util: 3, tempC: 41 },
  ])
})

test('parses several gpus and a name with a comma', () => {
  const gpus = parseGpus('0, Card A, 100, 8000, 0, 30\n1, Card, B, 200, 16000, 90, 70\n')
  expect(gpus.length).toBe(2)
  expect(gpus[1]?.name).toBe('Card, B')
  expect(gpus[1]?.totalMiB).toBe(16000)
})

test('a field the driver does not report is null', () => {
  const gpus = parseGpus('0, Card, 100, 8000, [N/A], [Not Supported]\n')
  expect(gpus[0]?.util).toBe(null)
  expect(gpus[0]?.tempC).toBe(null)
})

test('garbage and empty output parse to no gpus', () => {
  expect(parseGpus('')).toEqual([])
  expect(parseGpus('No devices were found')).toEqual([])
  expect(parseGpus('NVIDIA-SMI has failed because it could not communicate with the driver')).toEqual([])
  expect(parseGpus('0, Card, abc, def, 1, 2')).toEqual([])
})

test('parses the compute apps', () => {
  const apps = parseApps('1234, /usr/bin/python3, 4096\n77, ollama, 18000\n')
  expect(apps).toEqual([
    { pid: 1234, name: 'python3', usedMiB: 4096 },
    { pid: 77, name: 'ollama', usedMiB: 18000 },
  ])
})

test('an app name drops its arguments', () => {
  const raw = '5, /usr/bin/orca --gpu-preferences=WAAA/BBB== --shared-files, 1300\n'
  expect(parseApps(raw)).toEqual([{ pid: 5, name: 'orca', usedMiB: 1300 }])
})

test('an interpreter line names the script', () => {
  const raw = '6, /usr/bin/python3 /home/me/train.py --epochs 3, 4096\n'
  expect(parseApps(raw)[0]?.name).toBe('train.py')
})

test('a path with a space keeps the program name', () => {
  expect(parseApps('7, /opt/Roblox Studio/RobloxStudioBeta.exe, 1300\n')[0]?.name).toBe('RobloxStudioBeta.exe')
})

test('a windows path keeps the program name', () => {
  const raw = '4, C:\\Program Files\\Some App\\app.exe, 700\n'
  expect(parseApps(raw)[0]?.name).toBe('app.exe')
})

test('a comma inside the arguments does not drop the app', () => {
  const apps = parseApps('8, node server.js --list=a,b, 512\n')
  expect(apps).toEqual([{ pid: 8, name: 'node server.js', usedMiB: 512 }])
})

test('a very long name is clipped', () => {
  const name = parseApps(`9, ${'a'.repeat(100)}, 100\n`)[0]?.name ?? ''
  expect(name.length).toBe(40)
  expect(name.endsWith('…')).toBe(true)
})

test('an app with no reported memory counts as zero', () => {
  expect(parseApps('9, train, [N/A]\n')).toEqual([{ pid: 9, name: 'train', usedMiB: 0 }])
})

test('empty or odd app output parses to none', () => {
  expect(parseApps('')).toEqual([])
  expect(parseApps('No running processes found')).toEqual([])
})

const two = [
  { index: 0, name: 'a', usedMiB: 7000, totalMiB: 8000, util: null, tempC: null },
  { index: 1, name: 'b', usedMiB: 1000, totalMiB: 16000, util: null, tempC: null },
]

test('headroom is the most free gpu among those in play, with its own total', () => {
  expect(headroom(two, null)).toEqual({ freeMiB: 15000, totalMiB: 16000 })
  expect(headroom(two, [0])).toEqual({ freeMiB: 1000, totalMiB: 8000 })
  expect(headroom(two, [0, 1])).toEqual({ freeMiB: 15000, totalMiB: 16000 })
})

test('headroom ignores devices that do not exist, and falls back to all', () => {
  expect(headroom(two, [5])).toEqual({ freeMiB: 15000, totalMiB: 16000 })
  expect(headroom([], null)).toBe(null)
})

test('a trailing uuid names the card', () => {
  const gpus = parseGpus('0, Card, B, 100, 8000, 0, 30, GPU-aaaa-1111\n')
  expect(gpus).toEqual([
    { index: 0, name: 'Card, B', usedMiB: 100, totalMiB: 8000, util: 0, tempC: 30, uuid: 'GPU-aaaa-1111' },
  ])
})

test('an app names the card it runs on', () => {
  expect(parseApps('1234, /usr/bin/python3, 4096, GPU-aaaa-1111\n')).toEqual([
    { pid: 1234, name: 'python3', usedMiB: 4096, gpu: 'GPU-aaaa-1111' },
  ])
  expect(parseApps('9, my app, v2, 512, MIG-bbbb\n')[0]?.name).toBe('my app, v2')
})

test('the queries ask for the uuid', () => {
  expect(SMI_GPUS[1].endsWith(',uuid')).toBe(true)
  expect(SMI_APPS[1].endsWith(',gpu_uuid')).toBe(true)
})
