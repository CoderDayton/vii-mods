import type { Elements, RenderSurface } from 'claude-code'

import type { Seg } from './diff'
import type { ReviewModel } from './view'

export type Els = Elements[RenderSurface]

export type ReviewActions = {
  onAccept: () => void
  onEdit: () => void
  onOriginal: () => void
  onAuto: () => void
}

type Side = 'before' | 'after'

const CHANGED: Record<Side, { color: string; bold: boolean; strikethrough: boolean }> = {
  before: { color: 'error', bold: false, strikethrough: true },
  after: { color: 'success', bold: true, strikethrough: false },
}

const line = (els: Els, label: string, side: Side, segs: readonly Seg[]) => {
  const { Box, Text } = els
  const style = CHANGED[side]
  return (
    <Box>
      <Text dimColor>{`${label} `}</Text>
      <Text wrap="truncate-end">
        {segs.map(s =>
          s.isChanged ? (
            <Text color={style.color} bold={style.bold} strikethrough={style.strikethrough}>{s.text}</Text>
          ) : (
            <Text dimColor={side === 'before'}>{s.text}</Text>
          ),
        )}
      </Text>
    </Box>
  )
}

export const reviewView = (els: Els, m: ReviewModel, actions: ReviewActions) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
      <Box>
        <Text color="permission" bold>{'✎ Prompt repair'}</Text>
        <Text dimColor>{`  ${m.count}`}</Text>
      </Box>
      {line(els, 'was', 'before', m.before)}
      {line(els, 'now', 'after', m.after)}
      {m.summary !== '' && <Text dimColor>{m.summary}</Text>}
      <Box flexWrap="wrap" columnGap={2} marginTop={1}>
        <Button key="accept" label="Send fixed" hotkey="1" plain onPress={actions.onAccept} />
        <Button key="edit" label="Edit" hotkey="2" plain onPress={actions.onEdit} />
        <Button key="original" label="Send original" hotkey="3" plain onPress={actions.onOriginal} />
        <Button key="auto" label="Always auto" hotkey="4" plain dimColor onPress={actions.onAuto} />
      </Box>
    </Box>
  )
}
