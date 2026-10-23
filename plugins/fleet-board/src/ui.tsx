import type { Elements, RenderSurface } from 'claude-code'

import type { Note } from './fleet'
import { BACK_LABEL, CLOSE_LABEL, frameOf, REFRESH_LABEL } from './view'
import type { Detail, Line, Row, Tone } from './view'

export type Els = Elements[Exclude<RenderSurface, 'mobile'>]

// The pane shows the team and the other sessions. It has no write actions: the team changes through the fleet tools.
// `columns` is the width the pane has; frameOf cuts every line to fit inside the borders and padding.
export type PaneModel = {
  columns: number
  rows: Row[]
  notes: Note[]
  detail?: Detail
}

export type PaneActions = {
  onRefresh: () => void
  onClose: () => void
  onSelect: (id: string) => void
  onBack: () => void
}

const toneProps = (tone: Tone): { bold?: boolean; dimColor?: boolean; color?: string } => {
  if (tone === 'plain') return {}
  if (tone === 'bold') return { bold: true }
  if (tone === 'dim') return { dimColor: true }
  return { color: tone }
}

const segments = (els: Els, line: Line) => line.map((s, i) => <els.Text key={String(i)} {...toneProps(s.tone)}>{s.text}</els.Text>)

// One line of the frame: its segments side by side, each with its own tone. A blank line keeps its height.
const lineView = (els: Els, line: Line, key: string) => {
  const { Box, Text } = els
  if (line.length === 0) return <Text key={key}> </Text>
  return (
    <Box key={key}>
      {line.map((s, i) => (
        <Text key={String(i)} {...toneProps(s.tone)}>{s.text}</Text>
      ))}
    </Box>
  )
}

const sectionLine = (els: Els, a: PaneActions, line: Line, key: string, member: string | undefined) => {
  if (member === undefined) return lineView(els, line, key)
  return (
    <els.Button key={`member:${member}`} plain onPress={() => a.onSelect(member)}>
      {segments(els, line)}
    </els.Button>
  )
}

// Round dim borders throughout: the whole pane, then one box per section. The words carry the state; the colors only
// back them up.
export const paneView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text, Button } = els
  const frame = frameOf(m.rows, m.notes, m.columns, m.detail === undefined ? {} : { detail: m.detail })
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
      {lineView(els, frame.header, 'header')}
      {frame.sections.map(s => (
        <Box key={s.title} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} paddingY={1}>
          <Text dimColor>{s.title}</Text>
          {s.lines.map((l, i) => sectionLine(els, a, l, `${s.title}-${i}`, s.press?.[i]))}
        </Box>
      ))}
      <Box>
        {frame.back && <Button key="back" label={BACK_LABEL} hotkey="b" onPress={a.onBack} />}
        {frame.back && <Text>  </Text>}
        <Button key="refresh" label={REFRESH_LABEL} hotkey="r" onPress={a.onRefresh} />
        <Text>  </Text>
        <Button key="close" label={CLOSE_LABEL} hotkey="c" onPress={a.onClose} />
        <Text dimColor>  esc closes</Text>
      </Box>
    </Box>
  )
}
