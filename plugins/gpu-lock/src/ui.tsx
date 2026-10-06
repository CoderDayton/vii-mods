import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { BandModel, PaneModel, Tone } from './view'

export type Els = Elements[RenderSurface]

const COLOR: Record<Tone, string | undefined> = {
  mine: 'success',
  other: 'warning',
  waiting: 'warning',
  free: 'success',
  off: undefined,
}

const DOT: Record<Tone, string> = { mine: '●', other: '●', waiting: '◐', free: '○', off: '○' }

const ICON_COLOR: Record<string, string | undefined> = { '✓': 'success', '✗': 'error', '⊘': 'warning' }

// The band is one tree, so gpu-lock draws under whatever the plugins beneath it drew.
export const withBelow = (els: Els, below: RenderElement | null | undefined, mine: RenderElement): RenderElement => {
  const { Box } = els
  return below == null ? (
    mine
  ) : (
    <Box flexDirection="column">
      {below}
      {mine}
    </Box>
  )
}

export const bandView = (els: Els, m: BandModel) => {
  const { Box, Text } = els
  const color = COLOR[m.tone]
  const quiet = m.tone === 'free' || m.tone === 'off'
  return (
    <Box>
      <Text color={color} dimColor={quiet}>{`${DOT[m.tone]} `}</Text>
      <Text bold dimColor={quiet}>{m.title}</Text>
      {m.who !== '' && <Text dimColor>{`  ${m.who}`}</Text>}
      {m.cmd !== '' && <Text>{`  ${m.cmd}`}</Text>}
      {m.elapsed !== '' && <Text dimColor>{`  ${m.elapsed}`}</Text>}
      {m.meter !== null && <Text color={color}>{`  ${m.meter.bar}`}</Text>}
      {m.meter !== null && <Text dimColor>{` ${m.meter.text}`}</Text>}
    </Box>
  )
}

export type PaneActions = { onRefresh: () => void; onToggle: () => void; onClose: () => void }

export const paneView = (els: Els, m: PaneModel, actions: PaneActions) => {
  const { Box, Text, Button } = els
  const color = COLOR[m.tone === 'unknown' ? 'off' : m.tone]
  const dot = m.tone === 'unknown' ? '○' : DOT[m.tone]
  const width = Math.max(4, ...m.apps.map(a => a.name.length))
  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text color={color} bold>{`${dot} ${m.headline}`}</Text>
        {m.cmd !== '' && <Text>{m.cmd}</Text>}
        {m.detail !== '' && <Text dimColor>{m.detail}</Text>}
      </Box>

      {m.gpus.map(g => (
        <Box flexDirection="column">
          <Text bold>{g.title}</Text>
          <Box>
            <Text color={color}>{g.bar}</Text>
            <Text>{` ${g.used}`}</Text>
            {g.stats !== '' && <Text dimColor>{`  ${g.stats}`}</Text>}
          </Box>
        </Box>
      ))}
      {m.note !== '' && <Text color="warning">{m.note}</Text>}

      {m.apps.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Using the GPU</Text>
          {m.apps.map(a => (
            <Text>{`${a.name.padEnd(width)}  ${a.mem}`}</Text>
          ))}
        </Box>
      )}

      {m.log.length > 0 && (
        <Box flexDirection="column">
          <Text bold>This session</Text>
          {m.log.map(l => (
            <Box>
              <Text color={ICON_COLOR[l.icon]}>{`${l.icon} `}</Text>
              <Text>{l.text}</Text>
              <Text dimColor>{`  ${l.when}`}</Text>
            </Box>
          ))}
        </Box>
      )}

      {m.bad.length > 0 && <Text color="warning">{`Ignored patterns (not valid): ${m.bad.join(', ')}`}</Text>}

      <Box gap={2}>
        <Button key="refresh" label="Refresh" hotkey="r" onPress={actions.onRefresh} />
        <Button key="toggle" label={m.enabled ? 'Turn off' : 'Turn on'} hotkey="t" onPress={actions.onToggle} />
        <Button key="close" label="Close" hotkey="c" onPress={actions.onClose} />
      </Box>
    </Box>
  )
}
