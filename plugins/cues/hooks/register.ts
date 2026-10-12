import type { Hook, Register } from 'claude-code'

import { runCommand } from '../src/command'
import { clipForChar, clipForKey, pressClips, releaseClips } from '../src/keys'
import type { KeyClip } from '../src/keys'
import { playUrl } from '../src/request'
import { DEFAULTS, gainFor, restore } from '../src/settings'
import type { Settings, Switch } from '../src/settings'
import { Typist, keyDelay } from '../src/typist'

type Engine = Parameters<Hook<'session.start'>>[0]

const READY = 'cuesd ready'
const SETTINGS_KEY = 'settings'
// A key comes back up this long after it went down.
const RELEASE_MS = 70
// Every clip is equally loud as it loads, so these set the balance: a key coming back up is softer
// than it going down, and Claude's keys sit under the user's.
const RELEASE_GAIN = 0.5
const CLAUDE_GAIN = 0.75
const CHIME_GAIN = 1
// Each key press is a little louder or softer than the last, by up to this share.
const GAIN_SPREAD = 0.1

type Chime = 'send' | 'reply' | 'error'

type State = {
  settings: Settings
  socketPath: string
  // True once the player said it can play, until it exits.
  isReady: boolean
  typist: Typist
  typing: { cancel: () => void } | null
}

// Asks the player for a clip and does not wait: no sound is worth holding up a key or a turn.
// `volume` is the setting the clip plays at, 0 to 1.
const send = ($: Engine, s: State, clips: readonly string[], gain: number, volume: number): void => {
  if (!s.isReady || !s.settings.isOn) return
  void $.http.fetch(playUrl(clips, gain * gainFor(volume)), { socketPath: s.socketPath }).catch(() => undefined)
}

const pressKey = ($: Engine, s: State, board: Switch, clip: KeyClip, gain: number): void => {
  const level = gain * (1 - GAIN_SPREAD + Math.random() * 2 * GAIN_SPREAD)
  send($, s, pressClips(board, clip), level, s.settings.volume)
  $.clock.after(RELEASE_MS, () => send($, s, releaseClips(board, clip), level * RELEASE_GAIN, s.settings.volume))
}

const pressClaudeKey = ($: Engine, s: State, clip: KeyClip): void =>
  pressKey($, s, s.settings.claudeSwitch ?? s.settings.switch, clip, CLAUDE_GAIN)

// A `chimes/reply.wav` of the user's plays in place of the reply sound that was picked.
const chime = ($: Engine, s: State, name: Chime): void => {
  if (!s.settings[name]) return
  send($, s, name === 'reply' ? ['chimes/reply', `chimes/${s.settings.replySound}`] : [`chimes/${name}`], CHIME_GAIN, s.settings.chimeVolume)
}

// Types the next waiting character of Claude's text, then waits a typist's uneven moment for the one after.
const typeNext = ($: Engine, s: State): void => {
  const char = s.typist.next()
  if (char === null) {
    s.typing = null
    return
  }
  pressClaudeKey($, s, clipForChar(char))
  s.typing = $.clock.after(keyDelay(char, Math.random()), () => typeNext($, s))
}

const stopTyping = (s: State): void => {
  s.typist.clear()
  s.typing?.cancel()
  s.typing = null
}

const queueTyping = ($: Engine, s: State, text: string): void => {
  if (!s.isReady || !s.settings.isOn || !s.settings.claude) return
  s.typist.push(text)
  s.typing ??= $.clock.after(keyDelay('', Math.random()), () => typeNext($, s))
}

// Runs the player for as long as the session lives. A player that cannot start or that stops leaves
// the session silent, with one toast that says why.
const runPlayer = async ($: Engine, s: State): Promise<void> => {
  let complaint = ''
  try {
    const argv = ['bun', `${$.plugin.root}/bin/cuesd.ts`, `${$.plugin.root}/sounds`, s.socketPath]
    for await (const piece of $.process.spawn({ argv })) {
      if (!('text' in piece)) continue
      if (piece.stream === 'stderr') complaint = piece.text.trim()
      else if (piece.text.includes(READY)) s.isReady = true
    }
  } catch {
    complaint = 'cuesd: could not run bun. Install it from bun.sh.'
  }
  s.isReady = false
  if (complaint !== '') await $.ui.toast(`cues: no sound. ${complaint}`)
}

export const register: Register = on => {
  const s: State = { settings: DEFAULTS, socketPath: '', isReady: false, typist: new Typist(), typing: null }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    s.settings = restore(await $.store.get(SETTINGS_KEY))
    await $.command.register({ name: 'cues', description: 'Sounds: on or off, volume, key switch', argumentHint: 'on | off | volume [keys|chimes] 0-100 | <switch> | keys|claude|send|reply|error|chimes on|off' })
    if (!e.isInteractive) return started
    const runDir = (await $.env.get('XDG_RUNTIME_DIR')) ?? '/tmp'
    // The random part keeps a reloaded mod's new player off the path of the old one, which removes its
    // socket file as it shuts down.
    s.socketPath = `${runDir}/cues-${(await $.session.id()).slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}.sock`
    void runPlayer($, s)
    return started
  })

  on('prompt.edit', ($, e, next) => {
    if (s.settings.keys && e.key !== undefined && e.key.ctrl !== true && e.key.meta !== true) pressKey($, s, s.settings.switch, clipForKey(e.key.key), 1)
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'composer') {
      if (s.settings.keys) pressKey($, s, s.settings.switch, 'enter', 1)
      chime($, s, 'send')
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text') queueTyping($, s, chunk.text)
      yield chunk
    }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      stopTyping(s)
      if (e.reason === 'answer') chime($, s, 'reply')
      else if (e.reason === 'error' || e.reason === 'refusal') chime($, s, 'error')
    }
    return next(e)
  })

  on('command.run', { command: 'cues' }, async ($, e) => {
    const out = runCommand(e.args, s.settings, s.isReady)
    if (out.settings !== undefined) {
      const hasNewSwitch = out.settings.switch !== s.settings.switch
      const hasNewReply = out.settings.replySound !== s.settings.replySound
      const hasNewClaudeSwitch = out.settings.claudeSwitch !== s.settings.claudeSwitch
      const hasNewKeysVolumeOnly = out.settings.volume !== s.settings.volume && out.settings.chimeVolume === s.settings.chimeVolume
      s.settings = out.settings
      await $.store.set(SETTINGS_KEY, out.settings)
      if (!out.settings.claude || !out.settings.isOn) s.typist.clear()
      // The change is heard at once: a key of the new switch, the new reply sound, or a chime at the new volume.
      if (hasNewSwitch || hasNewKeysVolumeOnly) pressKey($, s, s.settings.switch, 'r2', 1)
      else if (hasNewClaudeSwitch) pressClaudeKey($, s, 'r2')
      else chime($, s, hasNewReply ? 'reply' : 'send')
    }
    return { text: out.text }
  })
}
