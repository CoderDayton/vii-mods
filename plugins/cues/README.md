# cues

Sound for Claude Code on Linux. Keys click as you type, and a short chime plays when you send a prompt, when the reply lands and when a turn fails.

## Sounds

| When | Sound |
| --- | --- |
| You press a key in the prompt box | That key's press, then its release |
| Claude writes reply text | Off unless you turn it on with `/cues claude on`: keys at a typist's uneven pace, about one every 110 ms, with a short pause after each word. Tool calls make no sound |
| You send a prompt | Enter, and the send chime |
| Claude's reply is done | The reply chime |
| A turn ends in an error or a refusal | The error chime |

Shortcuts with Ctrl or Alt, pasted text and sub-agents' replies make no sound. A turn you stop plays no chime.

## Needs

- Linux with PipeWire (`pw-cat`) or ALSA (`aplay`). PipeWire is used when both are there.
- [Bun](https://bun.sh) 1.4 or newer, to run the player.

With either missing the mod stays silent and says why in one toast.

## Commands

| Command | What it does |
| --- | --- |
| `/cues` | Shows the settings, lists the key switches, and says so when the player is not running |
| `/cues on`, `/cues off` | Turns every sound on or off (`unmute` and `mute` do the same) |
| `/cues volume` | Says what the keys volume and the chimes volume are |
| `/cues volume keys 40`, `/cues volume chimes 70` | Sets one of the two volumes, 0 to 100. The scale follows the ear: 50 sounds about half as loud as 100 |
| `/cues volume 40` | Sets both volumes at once |
| `/cues topre` | Picks a key switch, turns sound on and plays one key of it |
| `/cues keys off` | Turns your own key sounds off (`on` turns them back on) |
| `/cues claude on` | Turns on key sounds for what Claude writes. They are off by default, since Claude writes a lot |
| `/cues send off` | Turns the send chime off |
| `/cues claude topre` | Gives Claude's keys a switch of their own, and turns them on. `/cues claude same` goes back to your switch |
| `/cues reply off` | Turns the reply chime off |
| `/cues reply bell`, `/cues reply notes` | Picks the reply chime: a small bell (the default) or two low rising notes |
| `/cues error off` | Turns the error chime off |
| `/cues chimes off` | Turns all three chimes off at once |

Settings are remembered across sessions.

## Key switches

`mxblue`, `mxbrown` (the default), `mxblack`, `holypanda`, `topre`, `cream`, `alpaca`, `turquoise`, `blackink`, `redink`, `bluealps`, `boxnavy`, `buckling`.

## Your own sounds

Every sound is a 16-bit PCM `.wav` file under `sounds/`, read when a session starts. Any sample rate works; stereo is mixed down to one channel. Each switch and each chime is brought to the same loudness when it loads, so a quiet recording needs no editing.

| Path | Sound |
| --- | --- |
| `sounds/keys/<switch>/press/r0.wav` to `r4.wav` | A key on the number row (`r0`) down to the bottom row (`r4`) |
| `sounds/keys/<switch>/press/space.wav`, `enter.wav`, `backspace.wav` | Optional. Without one, the key plays a row sound |
| `sounds/keys/<switch>/release/key.wav` | Any key coming back up |
| `sounds/keys/<switch>/release/space.wav`, `enter.wav`, `backspace.wav` | Optional |
| `sounds/chimes/send.wav`, `reply.wav`, `error.wav` | Optional. Each replaces the built-in chime of that name. A `reply.wav` plays whichever reply sound is picked |

The chimes are made from sine notes when the player starts, so they ship as code (`src/audio/synth.ts`), not as files.

## How it works

The hooks cannot play sound themselves on Linux, so each session starts one small player, `bin/cuesd.ts`. It loads every clip into memory, brings each one to the same loudness so no switch or chime is louder than the next, mixes the ones that are playing, and writes the mix to `pw-cat` a few milliseconds ahead of the clock. Its PipeWire stream is named `cues` and starts at full level each session, so the volume to set is `/cues volume`. The hooks ask for a clip with one request on a Unix socket in `$XDG_RUNTIME_DIR` and never wait for the answer, so no key and no turn is held up by a sound. The player stops with the session.

PipeWire drops the start of a sound handed to a stream that ran dry, and a key click is mostly its start. So the player keeps the stream fed with silence for 3 seconds after each sound, and puts 45 ms of silence ahead of the first sound after a longer pause. After those 3 seconds it writes nothing and uses no CPU.

## Limits

- Linux only. On macOS and Windows the mod loads and stays silent.
- The first key after a pause of more than 3 seconds sounds about 45 ms later than the ones that follow.
- A key held down repeats its sound only as fast as the prompt box reports the repeats.
- Claude's typing is capped at the newest 30 characters still waiting, so the clicks stay close to the text on screen. It stops when the reply lands.

## Credits

The key recordings in `sounds/keys` are from [kbsim](https://github.com/tplai/kbsim) by Thomas Lai, under the MIT License in `sounds/keys/LICENSE`. They were converted to wav and trimmed of leading silence.
