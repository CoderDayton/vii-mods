import { expect, test } from 'claude-code/testing'

import { launchArgv, parseProbe, pickLauncher, PROBE_ARGV, splitArgs } from '../src/launch'
import type { Panes } from '../src/launch'

const NO_PANES: Panes = { tmuxPane: null, weztermPane: null }
const IN_TMUX: Panes = { tmuxPane: '%4', weztermPane: null }
const IN_WEZTERM: Panes = { tmuxPane: null, weztermPane: '7' }

test('the probe prints the launchers on the path, the display, and the pane this session runs in', () => {
  expect(PROBE_ARGV.slice(0, 2)).toEqual(['sh', '-c'])
  expect(PROBE_ARGV[2]).toContain('command -v')
  expect(PROBE_ARGV[2]).toContain('TMUX_PANE')
  expect(PROBE_ARGV[2]).toContain('WEZTERM_PANE')
  expect(parseProbe('ghostty\ntmux\ndisplay\n')).toEqual({ bins: ['ghostty', 'tmux'], display: true, ...NO_PANES })
  expect(parseProbe('tmux\ntmux-pane=%4\n')).toEqual({ bins: ['tmux'], display: false, ...IN_TMUX })
  expect(parseProbe('wezterm\nwezterm-pane=7\n')).toEqual({ bins: ['wezterm'], display: false, ...IN_WEZTERM })
  expect(parseProbe('')).toEqual({ bins: [], display: false, ...NO_PANES })
})

test('auto opens a pane in the terminal multiplexer this session runs in', () => {
  expect(pickLauncher('auto', { bins: ['ghostty', 'tmux'], display: true, ...IN_TMUX })).toBe('tmux-pane')
  expect(pickLauncher('auto', { bins: ['wezterm', 'ghostty'], display: true, ...IN_WEZTERM })).toBe('wezterm-pane')
})

test('auto opens a window when there is a display and a terminal for it', () => {
  expect(pickLauncher('auto', { bins: ['wezterm', 'ghostty', 'tmux'], display: true, ...NO_PANES })).toBe('ghostty')
  expect(pickLauncher('auto', { bins: ['wezterm', 'tmux'], display: true, ...NO_PANES })).toBe('wezterm')
})

test('auto falls back to a background tmux session without a display or a terminal', () => {
  expect(pickLauncher('auto', { bins: ['ghostty', 'tmux'], display: false, ...NO_PANES })).toBe('tmux')
  expect(pickLauncher('auto', { bins: ['tmux'], display: true, ...NO_PANES })).toBe('tmux')
  expect(pickLauncher('auto', { bins: [], display: true, ...NO_PANES })).toBeNull()
})

test('a named launcher is used only if it is installed', () => {
  expect(pickLauncher('tmux', { bins: ['ghostty', 'tmux'], display: true, ...NO_PANES })).toBe('tmux')
  expect(pickLauncher('ghostty', { bins: ['tmux'], display: true, ...NO_PANES })).toBeNull()
})

test('a named pane launcher is used only inside that multiplexer', () => {
  expect(pickLauncher('tmux-pane', { bins: ['tmux'], display: false, ...IN_TMUX })).toBe('tmux-pane')
  expect(pickLauncher('tmux-pane', { bins: ['tmux'], display: false, ...NO_PANES })).toBeNull()
  expect(pickLauncher('wezterm-pane', { bins: ['wezterm'], display: true, ...IN_WEZTERM })).toBe('wezterm-pane')
  expect(pickLauncher('wezterm-pane', { bins: ['wezterm'], display: true, ...IN_TMUX })).toBeNull()
})

test('argument text splits on spaces', () => {
  expect(splitArgs('')).toEqual([])
  expect(splitArgs('  --model  opus ')).toEqual(['--model', 'opus'])
})

test('each window or session launcher gets the folder and runs claude with the extra arguments', () => {
  expect(launchArgv('ghostty', '/p/q', ['--model', 'opus'], 'fleet-q', NO_PANES)).toEqual([
    'setsid', '-f', 'ghostty', '--working-directory=/p/q', '-e', 'claude', '--model', 'opus',
  ])
  expect(launchArgv('wezterm', '/p/q', [], 'fleet-q', NO_PANES)).toEqual(['setsid', '-f', 'wezterm', 'start', '--cwd', '/p/q', '--', 'claude'])
  expect(launchArgv('tmux', '/p/q', ['-c'], 'fleet-q', NO_PANES)).toEqual(['tmux', 'new-session', '-d', '-s', 'fleet-q', '-c', '/p/q', 'claude', '-c'])
})

test('a pane launcher splits the pane this session runs in and runs claude there', () => {
  expect(launchArgv('tmux-pane', '/p/q', ['--model', 'opus'], 'fleet-q', IN_TMUX)).toEqual([
    'tmux', 'split-window', '-h', '-t', '%4', '-c', '/p/q', 'claude', '--model', 'opus',
  ])
  expect(launchArgv('wezterm-pane', '/p/q', [], 'fleet-q', IN_WEZTERM)).toEqual([
    'wezterm', 'cli', 'split-pane', '--right', '--cwd', '/p/q', '--pane-id', '7', '--', 'claude',
  ])
})
