// Opening a new Claude session from the pane: in a terminal window when the machine has a display and a
// terminal this knows, otherwise in a background tmux session the person can attach to.

export type Launcher = 'ghostty' | 'wezterm' | 'tmux'

export type LauncherOption = 'auto' | Launcher

export type Probe = { bins: string[]; display: boolean }

const LAUNCHERS: readonly Launcher[] = ['ghostty', 'wezterm', 'tmux']

const PROBE = `for b in ghostty wezterm tmux; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done
[ -n "$WAYLAND_DISPLAY$DISPLAY" ] && echo display
exit 0`

export const PROBE_ARGV: string[] = ['sh', '-c', PROBE, 'fleet-board-probe']

export const parseProbe = (stdout: string): Probe => {
  const words = stdout.split('\n').map(w => w.trim())
  return { bins: words.filter(w => LAUNCHERS.includes(w as Launcher)), display: words.includes('display') }
}

export const pickLauncher = (option: LauncherOption, probe: Probe): Launcher | null => {
  if (option !== 'auto') return probe.bins.includes(option) ? option : null
  const window = probe.display ? LAUNCHERS.find(l => l !== 'tmux' && probe.bins.includes(l)) : undefined
  return window ?? (probe.bins.includes('tmux') ? 'tmux' : null)
}

export const splitArgs = (text: string): string[] => text.split(/\s+/).filter(Boolean)

// A window launcher is detached with setsid, so the run call returns once the window is up.
export const launchArgv = (launcher: Launcher, dir: string, args: readonly string[], tag: string): string[] => {
  switch (launcher) {
    case 'ghostty':
      return ['setsid', '-f', 'ghostty', `--working-directory=${dir}`, '-e', 'claude', ...args]
    case 'wezterm':
      return ['setsid', '-f', 'wezterm', 'start', '--cwd', dir, '--', 'claude', ...args]
    case 'tmux':
      return ['tmux', 'new-session', '-d', '-s', tag, '-c', dir, 'claude', ...args]
  }
}
