import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Seg } from './diff'
import type { ReviewModel, Row } from './view'

export type Els = Elements[RenderSurface]

// An unbound engine action that nothing handles outside the diff panel: the person binds
// their shortcut to it in keybindings.json, and it presses the button that carries it.
export const ACTION = 'app:toggleDiffNoiseFilter'

export type ReviewActions = {
  onApply: () => void
  onDismiss: () => void
}

const SIGNS = { ctx: ' ', del: '−', ins: '+', fold: ' ' } as const
const COLORS = { del: 'error', ins: 'success' } as const

const segText = (els: Els, row: Row, seg: Seg) => {
  const { Text } = els
  if (row.kind === 'ctx') return <Text dimColor>{seg.text}</Text>
  const color = COLORS[row.kind as 'del' | 'ins']
  return seg.isChanged ? (
    <Text color={color} bold strikethrough={row.kind === 'del'}>{seg.text}</Text>
  ) : (
    <Text color={color} dimColor>{seg.text}</Text>
  )
}

// A gutter that keeps its width and a text column that takes the rest and wraps, so a long
// line wraps under its own text at any width.
const rowView = (els: Els, row: Row) => {
  const { Box, Text } = els
  if (row.kind === 'fold') {
    return (
      <Box>
        <Box width={2} flexShrink={0} />
        <Text dimColor>{`⋯ ${row.skipped ?? 0} unchanged ${row.skipped === 1 ? 'line' : 'lines'}`}</Text>
      </Box>
    )
  }
  const sign = SIGNS[row.kind]
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={row.kind === 'ctx' ? undefined : COLORS[row.kind]} bold>{sign}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">{row.segs.length === 0 ? ' ' : row.segs.map(seg => segText(els, row, seg))}</Text>
      </Box>
    </Box>
  )
}

// The band is one tree, so rescribe draws under whatever the plugins beneath it drew.
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

export const idleView = (els: Els, onEnhance: () => void, chord: string | null) => {
  const { Box, Text, Button } = els
  return (
    <Box>
      <Button key="enhance" label="✎ rescribe" action={ACTION} plain dimColor onPress={onEnhance} />
      {chord !== null && <Text dimColor>{`  ${chord}`}</Text>}
    </Box>
  )
}

export const reviewView = (els: Els, m: ReviewModel, actions: ReviewActions, chord: string | null) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="permission" paddingX={1}>
      <Box flexWrap="wrap" columnGap={2}>
        <Text color="permission" bold>{'✎ rescribe'}</Text>
        <Text dimColor>{`${m.count} · ${m.size}`}</Text>
      </Box>
      <Box flexWrap="wrap" columnGap={2}>
        <Button key="apply" label="Apply" action={ACTION} onPress={actions.onApply} />
        <Button key="dismiss" label="Dismiss" onPress={actions.onDismiss} />
        <Text dimColor>{`${chord ?? 'the shortcut'} applies · typing dismisses`}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {m.rows.map(row => rowView(els, row))}
      </Box>
    </Box>
  )
}
