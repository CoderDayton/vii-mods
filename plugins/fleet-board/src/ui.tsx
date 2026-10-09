import type { Elements, RenderSurface } from 'claude-code'

import type { Note } from './fleet'
import { KEY_WIDTH, layoutOf } from './view'
import type { Layout, Row } from './view'

export type Els = Elements[Exclude<RenderSurface, 'mobile'>]

// The pane shows the team and the other sessions. It has no write actions: the team changes through the fleet tools.
export type PaneModel = {
  columns: number
  headline: string
  rows: Row[]
  notes: Note[]
}

export type PaneActions = {
  onRefresh: () => void
  onClose: () => void
}

const STATE_WIDTH = 7

const rowColor = (r: Row): string | undefined => (r.isQuiet ? 'warning' : r.state === 'working' ? 'success' : undefined)

const ellipsize = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

// One session. A wide pane keeps it on one line; a narrow one puts the folder and role on a second line. A team
// member's task and the first line of its reply go under it.
const sessionRow = (els: Els, l: Layout, r: Row) => {
  const { Box, Text } = els
  const color = rowColor(r)
  const idle = r.state !== 'working'
  const age = r.isQuiet ? `${r.age} !` : r.age
  const hasRole = r.role !== '—'
  const detail = r.task === '' ? '' : r.last === '' ? r.task : `${r.task} — ${r.last}`
  return (
    <Box key={r.id} flexDirection="column">
      <Box columnGap={1}>
        <Text color={color} dimColor={idle}>{r.state === 'working' ? '●' : '○'}</Text>
        <Box width={l.name} flexShrink={0}>
          <Text bold={hasRole} wrap="truncate-end">{ellipsize(r.name, l.name - KEY_WIDTH)}</Text>
        </Box>
        {l.wide && (
          <Box width={l.folder} flexShrink={0}>
            <Text dimColor wrap="truncate-end">{r.folder}</Text>
          </Box>
        )}
        <Box width={STATE_WIDTH} flexShrink={0}>
          <Text color={color} dimColor={idle}>{r.state}</Text>
        </Box>
        <Box width={l.age} flexShrink={0} justifyContent="flex-end">
          <Text color={r.isQuiet ? 'warning' : undefined} dimColor={!r.isQuiet}>{age}</Text>
        </Box>
        {l.wide && <Text bold={hasRole} dimColor={!hasRole}>{r.role}</Text>}
      </Box>
      {!l.wide && (
        <Box paddingLeft={KEY_WIDTH + 2}>
          <Text dimColor wrap="truncate-end">{hasRole ? `${r.folder} · ${r.role}` : r.folder}</Text>
        </Box>
      )}
      {detail !== '' && (
        <Box paddingLeft={KEY_WIDTH + 2}>
          <Text dimColor wrap="truncate-end">{detail}</Text>
        </Box>
      )}
    </Box>
  )
}

const rowGroup = (els: Els, l: Layout, title: string, rows: readonly Row[]) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {rows.map(r => sessionRow(els, l, r))}
    </Box>
  )
}

// The team first: the sessions the boss has hired. The rest are the other sessions.
const boardRows = (els: Els, m: PaneModel) => {
  const { Box, Text } = els
  const l = layoutOf(m.columns, m.rows)
  const team = m.rows.filter(r => r.role !== '—')
  const others = m.rows.filter(r => r.role === '—')
  return (
    <Box flexDirection="column" gap={1}>
      {team.length > 0 ? rowGroup(els, l, 'Your team', team) : <Text dimColor>Your team is empty.</Text>}
      {others.length > 0 && rowGroup(els, l, 'Other sessions', others)}
    </Box>
  )
}

const boardView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{m.headline}</Text>
      <Text dimColor>The boss hires, tasks and drops its team with the fleet tools. This pane only shows it.</Text>
      {m.rows.length > 0 ? boardRows(els, m) : <Text dimColor>No other Claude session is running.</Text>}
      <Box columnGap={2} flexWrap="wrap">
        <Button key="refresh" label="Refresh" hotkey="r" onPress={a.onRefresh} />
        <Button key="close" label="Close" hotkey="c" onPress={a.onClose} />
      </Box>
    </Box>
  )
}

export const paneView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      {boardView(els, m, a)}
      {m.notes.length > 0 && (
        <Box flexDirection="column">
          {m.notes.map(n => (
            <Text key={`${n.at}-${n.text}`} color={n.ok ? 'success' : 'error'} wrap="truncate-end">{`${n.ok ? '✓' : '✗'} ${n.text}`}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
