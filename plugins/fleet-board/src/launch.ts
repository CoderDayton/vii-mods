// Opening a new Claude session from the pane. Inside tmux or WezTerm it splits a pane of that multiplexer.
// Otherwise it opens a terminal window when the machine has a display and a terminal this knows, or a
// background tmux session the person can attach to.

export type Launcher = 'ghostty' | 'wezterm' | 'tmux' | 'tmux-pane' | 'wezterm-pane'

export type LauncherOption = 'auto' | Launcher

// The pane this session runs in, when it runs inside tmux or WezTerm.
export type Panes = { tmuxPane: string | null; weztermPane: string | null }

export type Probe = Panes & { bins: string[]; display: boolean }

const LAUNCHERS: readonly Launcher[] = ['ghostty', 'wezterm', 'tmux']

const PROBE = `for b in ghostty wezterm tmux; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done
[ -n "$WAYLAND_DISPLAY$DISPLAY" ] && echo display
[ -n "$TMUX_PANE" ] && echo "tmux-pane=$TMUX_PANE"
[ -n "$WEZTERM_PANE" ] && echo "wezterm-pane=$WEZTERM_PANE"
exit 0`

export const PROBE_ARGV: string[] = ['sh', '-c', PROBE, 'fleet-board-probe']

const valueOf = (words: readonly string[], key: string): string | null => {
  const line = words.find(w => w.startsWith(`${key}=`))
  const value = line?.slice(key.length + 1) ?? ''
  return value === '' ? null : value
}

export const parseProbe = (stdout: string): Probe => {
  const words = stdout.split('\n').map(w => w.trim())
  return {
    bins: words.filter(w => LAUNCHERS.includes(w as Launcher)),
    display: words.includes('display'),
    tmuxPane: valueOf(words, 'tmux-pane'),
    weztermPane: valueOf(words, 'wezterm-pane'),
  }
}

const has = (probe: Probe, bin: string): boolean => probe.bins.includes(bin)

// A pane launcher runs only inside the multiplexer that holds the pane.
const usable = (launcher: Launcher, probe: Probe): boolean => {
  switch (launcher) {
    case 'tmux-pane':
      return probe.tmuxPane !== null && has(probe, 'tmux')
    case 'wezterm-pane':
      return probe.weztermPane !== null && has(probe, 'wezterm')
    default:
      return has(probe, launcher)
  }
}

export const pickLauncher = (option: LauncherOption, probe: Probe): Launcher | null => {
  if (option !== 'auto') return usable(option, probe) ? option : null
  const pane = (['tmux-pane', 'wezterm-pane'] as const).find(l => usable(l, probe))
  if (pane !== undefined) return pane
  const window = probe.display ? LAUNCHERS.find(l => l !== 'tmux' && usable(l, probe)) : undefined
  return window ?? (has(probe, 'tmux') ? 'tmux' : null)
}

export const splitArgs = (text: string): string[] => text.split(/\s+/).filter(Boolean)

// What the pane says the session opened as, after "opened <name> in ".
export const describeLauncher = (launcher: Launcher): string => {
  switch (launcher) {
    case 'tmux':
      return 'a background tmux session'
    case 'tmux-pane':
      return 'a new tmux pane'
    case 'wezterm-pane':
      return 'a new WezTerm pane'
    default:
      return `a ${launcher} window`
  }
}

// A window launcher is detached with setsid, so the run call returns once the window is up. A pane launcher
// splits the pane named in `panes`; without one the multiplexer splits its current pane.
export const launchArgv = (launcher: Launcher, dir: string, args: readonly string[], tag: string, panes: Panes): string[] => {
  switch (launcher) {
    case 'ghostty':
      return ['setsid', '-f', 'ghostty', `--working-directory=${dir}`, '-e', 'claude', ...args]
    case 'wezterm':
      return ['setsid', '-f', 'wezterm', 'start', '--cwd', dir, '--', 'claude', ...args]
    case 'tmux':
      return ['tmux', 'new-session', '-d', '-s', tag, '-c', dir, 'claude', ...args]
    case 'tmux-pane':
      return ['tmux', 'split-window', '-h', ...(panes.tmuxPane === null ? [] : ['-t', panes.tmuxPane]), '-c', dir, 'claude', ...args]
    case 'wezterm-pane':
      return [
        'wezterm', 'cli', 'split-pane', '--right', '--cwd', dir,
        ...(panes.weztermPane === null ? [] : ['--pane-id', panes.weztermPane]),
        '--', 'claude', ...args,
      ]
  }
}
