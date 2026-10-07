import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { ChartCard, Charts, LegendItem, Paint } from './history'
import { columnWidths } from './view'
import type { BandModel, PaneJob, PaneModel, Tone } from './view'

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

// The filled part of a meter takes the tone colour; the empty part recedes.
const meterBar = (els: Els, bar: string, color: string | undefined) => {
  const { Box, Text } = els
  const filled = bar.replace(/░/g, '')
  return (
    <Box>
      <Text color={color}>{filled}</Text>
      <Text dimColor>{bar.slice(filled.length)}</Text>
    </Box>
  )
}

// One line per session. Columns share widths across rows, and no cell wraps: the command gives way first.
export const bandView = (els: Els, m: BandModel) => {
  const { Box, Text } = els
  const w = columnWidths(m.rows)
  const meterWidth = m.meter === null ? 0 : m.meter.bar.length + 1 + m.meter.text.length
  return (
    <Box flexDirection="column">
      {m.rows.map((r, i) => {
        const color = COLOR[r.tone]
        const quiet = r.tone === 'free' || r.tone === 'off'
        return (
          <Box key={`${r.title}-${i}`} columnGap={2}>
            <Box width={1} flexShrink={0}>
              <Text color={color} dimColor={quiet}>{DOT[r.tone]}</Text>
            </Box>
            <Box width={w.title} flexShrink={0}>
              <Text bold dimColor={quiet} wrap="truncate-end">{r.title}</Text>
            </Box>
            {w.who > 0 && (
              <Box width={w.who} flexShrink={0}>
                <Text dimColor wrap="truncate-end">{r.who}</Text>
              </Box>
            )}
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{r.cmd}</Text>
            </Box>
            {w.elapsed > 0 && (
              <Box width={w.elapsed} flexShrink={0} justifyContent="flex-end">
                <Text dimColor wrap="truncate-end">{r.elapsed}</Text>
              </Box>
            )}
            {m.meter !== null && (
              <Box width={meterWidth} flexShrink={0} columnGap={1}>
                {i === 0 && meterBar(els, m.meter.bar, color)}
                {i === 0 && <Text dimColor>{m.meter.text}</Text>}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

const jobList = (els: Els, title: string, jobs: readonly PaneJob[], color: string) => {
  const { Box, Text } = els
  const who = Math.max(...jobs.map(j => (j.place > 0 ? `${j.place}. ${j.who}` : j.who).length))
  const elapsed = Math.max(...jobs.map(j => j.elapsed.length))
  return (
    <Box flexDirection="column">
      <Text bold dimColor>{title}</Text>
      {jobs.map(j => (
        <Box key={`${j.who}-${j.cmd}-${j.elapsed}`} columnGap={2}>
          <Box width={who} flexShrink={0}>
            <Text color={j.mine ? color : undefined} wrap="truncate-end">{j.place > 0 ? `${j.place}. ${j.who}` : j.who}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{j.cmd}</Text>
          </Box>
          {j.need !== '' && <Text dimColor>{`needs ${j.need}`}</Text>}
          <Box width={elapsed} flexShrink={0} justifyContent="flex-end">
            <Text dimColor>{j.elapsed}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// Terminal palette names, so a job keeps a distinct colour on any theme. Memory no job owns is grey.
const JOB_COLORS = ['cyan', 'magenta', 'blue', 'yellow', 'green']

const paintColor = (paint: Paint | null): string | undefined => {
  if (paint === null || paint === 'blank' || paint === 'cap') return undefined
  return paint === 'other' ? 'gray' : JOB_COLORS[paint % JOB_COLORS.length]
}

const legendRow = (els: Els, item: LegendItem) => {
  const { Box, Text } = els
  return (
    <Box key={`${item.label}-${item.mem}`} columnGap={1}>
      <Text color={paintColor(item.paint)}>■</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{item.label}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{item.mem}</Text>
      </Box>
    </Box>
  )
}

const chartRow = (els: Els, row: ChartCard['rows'][number], i: number) => {
  const { Box, Text } = els
  return (
    <Box key={`row-${i}`} columnGap={1}>
      <Text dimColor>{row.label}</Text>
      <Box>
        {row.runs.map((run, n) => (
          <Text key={`${i}-${n}`} color={paintColor(run.fg)} backgroundColor={paintColor(run.bg)} dimColor={run.fg === 'cap'}>
            {run.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

const chartCard = (els: Els, card: ChartCard, c: number) => {
  const { Box, Text } = els
  return (
    <Box key={`card-${c}`} flexDirection="column">
      <Text bold dimColor wrap="truncate-end">{card.title}</Text>
      {card.rows.map((r, i) => chartRow(els, r, i))}
      <Text dimColor wrap="truncate-end">{card.summary}</Text>
    </Box>
  )
}

// Memory over the last minutes, one chart per card: a column per slice of time, stacked by job, the cap a dashed line.
const chartView = (els: Els, charts: Charts) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {charts.cards.map((card, c) => chartCard(els, card, c))}
      <Text dimColor>{charts.axis}</Text>
      {charts.legend.map(item => legendRow(els, item))}
    </Box>
  )
}

export type PaneActions = { onRefresh: () => void; onToggle: () => void; onClose: () => void }

export const paneView = (els: Els, m: PaneModel, actions: PaneActions) => {
  const { Box, Text, Button } = els
  const color = COLOR[m.tone === 'unknown' ? 'off' : m.tone]
  const dot = m.tone === 'unknown' ? '○' : DOT[m.tone]
  const width = Math.max(4, ...m.apps.map(a => a.name.length))
  const memWidth = Math.max(...m.apps.map(a => a.mem.length), 0)
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
            {meterBar(els, g.bar, color)}
            <Text>{` ${g.used}`}</Text>
            {g.stats !== '' && <Text dimColor>{`  ${g.stats}`}</Text>}
          </Box>
        </Box>
      ))}
      {m.note !== '' && <Text color="warning">{m.note}</Text>}
      {m.chart !== null && chartView(els, m.chart)}

      {m.running.length > 0 && jobList(els, 'Running', m.running, 'success')}
      {m.queue.length > 0 && jobList(els, 'Waiting for a turn', m.queue, 'warning')}

      {m.apps.length > 0 && (
        <Box flexDirection="column">
          <Text bold dimColor>Using the GPU</Text>
          {m.apps.map(a => (
            <Text>{`${a.name.padEnd(width)}  ${a.mem.padStart(memWidth)}`}</Text>
          ))}
        </Box>
      )}

      {m.log.length > 0 && (
        <Box flexDirection="column">
          <Text bold dimColor>This session</Text>
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
