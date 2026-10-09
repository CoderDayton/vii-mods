import type { Elements, RenderSurface } from 'claude-code'

import type { Note } from './fleet'
import { ROLES } from './roles'
import type { RoleId } from './roles'
import { KEY_WIDTH, layoutOf } from './view'
import type { Layout, Row } from './view'

export type Els = Elements[Exclude<RenderSurface, 'mobile'>]

export type DirOption = { value: string; label: string }

export type PaneModel = {
  columns: number
  headline: string
  rows: Row[]
  selected: Row | null
  view: 'board' | 'new'
  role: RoleId
  dirs: DirOption[]
  dir: string
  msg: string
  task: string
  notes: Note[]
  busy: string
  confirmDisband: boolean
}

export type PaneActions = {
  onPick: (id: string) => void
  onPing: () => void
  onBrief: () => void
  onStop: () => void
  onDrop: () => void
  onPingTeam: () => void
  onDisband: () => void
  onRefresh: () => void
  onClose: () => void
  onNew: () => void
  onBack: () => void
  onRole: (id: string) => void
  onDir: (dir: string) => void
  onMsg: (text: string) => void
  onSend: (text: string) => void
  onTask: (text: string) => void
  onOpen: (text: string) => void
}

const STATE_WIDTH = 7

const roleOptions = ROLES.map(r => ({ value: r.id, label: r.label }))

const rowColor = (r: Row): string | undefined => (r.isQuiet ? 'warning' : r.state === 'working' ? 'success' : undefined)

const ellipsize = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

// One session. A wide pane keeps it on one line; a narrow one puts the folder and role on a second line.
const sessionRow = (els: Els, m: PaneModel, a: PaneActions, l: Layout, r: Row) => {
  const { Box, Text, Button } = els
  const color = rowColor(r)
  const idle = r.state !== 'working'
  const age = r.isQuiet ? `${r.age} !` : r.age
  const hasRole = r.role !== '—'
  return (
    <Box key={r.id} flexDirection="column">
      <Box columnGap={1}>
        <Text bold>{m.selected?.id === r.id ? '▸' : ' '}</Text>
        <Text color={color} dimColor={idle}>{r.state === 'working' ? '●' : '○'}</Text>
        <Box width={l.name} flexShrink={0}>
          <Button
            key={`row-${r.id}`}
            plain
            hotkey={r.n <= 9 ? String(r.n) : undefined}
            label={ellipsize(r.name, l.name - KEY_WIDTH)}
            onPress={() => a.onPick(r.id)}
          />
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
    </Box>
  )
}

const rowGroup = (els: Els, m: PaneModel, a: PaneActions, l: Layout, title: string, rows: readonly Row[]) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {rows.map(r => sessionRow(els, m, a, l, r))}
    </Box>
  )
}

// The team first: the sessions the boss has briefed. The rest are the sessions it can hire.
const boardRows = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text } = els
  const l = layoutOf(m.columns, m.rows)
  const team = m.rows.filter(r => r.role !== '—')
  const others = m.rows.filter(r => r.role === '—')
  return (
    <Box flexDirection="column" gap={1}>
      {team.length > 0 ? rowGroup(els, m, a, l, 'Your team', team) : <Text dimColor>Your team is empty.</Text>}
      {others.length > 0 && rowGroup(els, m, a, l, 'Other sessions', others)}
    </Box>
  )
}

const pickedPanel = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text, Button, Input, Select } = els
  const pick = m.selected
  if (pick === null) return <Text dimColor>{m.rows.length === 0 ? 'Press n to open a session.' : 'Press a number to pick a session.'}</Text>
  const isMember = pick.role !== '—'
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">{`▸ ${pick.name}`}</Text>
      <Input
        key="message"
        label="Task"
        placeholder="what should it do? Enter sends"
        value={m.msg}
        submitLabel="send"
        onInput={a.onMsg}
        onSubmit={a.onSend}
      />
      <Box columnGap={2} flexWrap="wrap">
        <Button key="ping" label="Ping" hotkey="p" onPress={a.onPing} />
        <Button key="brief" label="Hire as" hotkey="b" onPress={a.onBrief} />
        <Select key="role" label="Role" options={roleOptions} value={m.role} onSelect={a.onRole} />
        <Button key="stop" label="Stop run" hotkey="s" onPress={a.onStop} />
        {isMember && <Button key="drop" label="Drop from team" onPress={a.onDrop} />}
      </Box>
    </Box>
  )
}

const boardView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{m.headline}</Text>
      <Text dimColor>Hire a session to make it your employee. Then send it tasks.</Text>
      {m.rows.length > 0 && boardRows(els, m, a)}
      {pickedPanel(els, m, a)}
      {m.confirmDisband && <Text color="warning">Every employee is told the team is disbanded. Press Confirm disband to do it.</Text>}
      <Box columnGap={2} flexWrap="wrap">
        <Button key="team" label="Ping team" hotkey="t" onPress={a.onPingTeam} />
        <Button key="new" label="New session" hotkey="n" onPress={a.onNew} />
        <Button key="disband" label={m.confirmDisband ? 'Confirm disband' : 'Disband team'} hotkey="d" onPress={a.onDisband} />
        <Button key="refresh" label="Refresh" hotkey="r" onPress={a.onRefresh} />
        <Button key="close" label="Close" hotkey="c" onPress={a.onClose} />
      </Box>
    </Box>
  )
}

const newView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text, Button, Input, Select } = els
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>New session</Text>
      <Box flexDirection="column">
        <Select key="dir" label="Folder" options={m.dirs} value={m.dir} onSelect={a.onDir} />
        <Select key="role" label="Role" options={roleOptions} value={m.role} onSelect={a.onRole} />
        <Input
          key="first-task"
          label="First task"
          placeholder="optional; Enter opens the session"
          value={m.task}
          submitLabel="open"
          onInput={a.onTask}
          onSubmit={a.onOpen}
        />
      </Box>
      <Box gap={2}>
        <Button key="open" label="Open" hotkey="o" variant="primary" onPress={() => a.onOpen(m.task)} />
        <Button key="back" label="Back" hotkey="b" onPress={a.onBack} />
      </Box>
    </Box>
  )
}

export const paneView = (els: Els, m: PaneModel, a: PaneActions) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      {m.view === 'board' ? boardView(els, m, a) : newView(els, m, a)}
      {(m.busy !== '' || m.notes.length > 0) && (
        <Box flexDirection="column">
          {m.notes.map(n => (
            <Text key={`${n.at}-${n.text}`} color={n.ok ? 'success' : 'error'} wrap="truncate-end">{`${n.ok ? '✓' : '✗'} ${n.text}`}</Text>
          ))}
          {m.busy !== '' && <Text color="warning">{`… ${m.busy}`}</Text>}
        </Box>
      )}
    </Box>
  )
}
