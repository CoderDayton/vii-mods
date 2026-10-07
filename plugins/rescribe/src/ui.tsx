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
// The theme's own diff tints: a soft one across the row, a strong one behind the changed words.
const TINTS = { del: 'diffRemoved', ins: 'diffAdded' } as const
const WORD_TINTS = { del: 'diffRemovedWord', ins: 'diffAddedWord' } as const

const segText = (els: Els, row: Row, seg: Seg) => {
  const { Text } = els
  if (row.kind === 'ctx') return <Text dimColor>{seg.text}</Text>
  const kind = row.kind as 'del' | 'ins'
  return seg.isChanged ? <Text backgroundColor={WORD_TINTS[kind]} bold>{seg.text}</Text> : <Text>{seg.text}</Text>
}

// A gutter that keeps its width and a text column that takes the rest and wraps, so a long
// line wraps under its own text at any width. A removed or added row is tinted edge to edge.
const rowView = (els: Els, row: Row) => {
  const { Box, Text } = els
  if (row.kind === 'fold') {
    return (
      <Box>
        <Box width={3} flexShrink={0} />
        <Text dimColor>{`⋯ ${row.skipped ?? 0} unchanged ${row.skipped === 1 ? 'line' : 'lines'}`}</Text>
      </Box>
    )
  }
  const sign = SIGNS[row.kind]
  const isChange = row.kind !== 'ctx'
  return (
    <Box backgroundColor={isChange ? TINTS[row.kind as 'del' | 'ins'] : undefined}>
      <Box width={3} flexShrink={0} paddingLeft={1}>
        <Text color={isChange ? COLORS[row.kind as 'del' | 'ins'] : undefined} bold>{sign}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} paddingRight={1}>
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

// The shortcut works only while its button is mounted, so the button stays, in a box that takes no rows.
export const idleView = (els: Els, onEnhance: () => void) => {
  const { Box, Button } = els
  return (
    <Box height={0} overflow="hidden">
      <Button key="enhance" label="✎ Enhance Prompt" action={ACTION} plain dimColor onPress={onEnhance} />
    </Box>
  )
}

const diffRows = (els: Els, m: ReviewModel) => {
  const { Box } = els
  return <Box flexDirection="column">{m.rows.map(row => rowView(els, row))}</Box>
}

// The title, the count and the buttons. With the diff open in a pane the band is these two rows alone;
// without a pane the whole diff sits under them, in a frame.
export const reviewView = (
  els: Els,
  m: ReviewModel,
  actions: ReviewActions,
  chord: string | null,
  isDiffShown: boolean,
) => {
  const { Box, Text, Button } = els
  const head = (
    <Box flexDirection="column">
      <Box flexWrap="wrap" columnGap={2}>
        <Text color="permission" bold>{'✎ Enhance Prompt'}</Text>
        <Text dimColor>{`${m.count} · ${m.size}`}</Text>
      </Box>
      <Box flexWrap="wrap" columnGap={2}>
        <Button key="apply" label="Apply" action={ACTION} onPress={actions.onApply} />
        <Button key="dismiss" label="Dismiss" onPress={actions.onDismiss} />
        <Text dimColor>{`${chord ?? 'the shortcut'} applies · typing dismisses`}</Text>
      </Box>
    </Box>
  )
  if (!isDiffShown) return head
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="permission" paddingX={1}>
      {head}
      <Box flexDirection="column" marginTop={1}>
        {diffRows(els, m)}
      </Box>
    </Box>
  )
}

// A header with the lines removed and added, a rule, then the diff.
export const paneView = (els: Els, m: ReviewModel | null) => {
  const { Box, Text } = els
  if (m === null) return <Text dimColor>nothing to review</Text>
  const removed = m.rows.filter(row => row.kind === 'del').length
  const added = m.rows.filter(row => row.kind === 'ins').length
  return (
    <Box flexDirection="column">
      <Box paddingX={1} columnGap={2} flexWrap="wrap">
        <Text bold>Changes</Text>
        <Text color="error" bold>{`−${removed}`}</Text>
        <Text color="success" bold>{`+${added}`}</Text>
      </Box>
      <Box height={1} overflow="hidden">
        <Text dimColor wrap="wrap">{'─'.repeat(240)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {diffRows(els, m)}
      </Box>
    </Box>
  )
}
