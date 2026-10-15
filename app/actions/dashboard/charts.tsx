import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { routes } from '../../routes.ts'
import type { BoardProgress, ProgressSummary } from './boards/data.ts'

// Card stages, ordered from not started to done. One blue ramp, darkening toward "done" in
// light mode and brightening toward it in dark mode; validated as an ordinal ramp against
// the panel surface in both.
const stages = [
  { key: 'todo', label: 'To do', color: 'var(--stage-todo)' },
  { key: 'inProgress', label: 'In progress', color: 'var(--stage-progress)' },
  { key: 'done', label: 'Done', color: 'var(--stage-done)' },
] as const

export const chartTokens = css({
  '--stage-todo': '#6da7ec',
  '--stage-progress': '#2a78d6',
  '--stage-done': '#184f95',
  '--chart-grid': 'color-mix(in srgb, var(--text-tertiary) 25%, transparent)',
  '@media (prefers-color-scheme: dark)': {
    '--stage-todo': '#256abf',
    '--stage-progress': '#5598e7',
    '--stage-done': '#9ec5f4',
  },
})

function totals(boards: BoardProgress[]) {
  let todo = 0
  let inProgress = 0
  let done = 0
  for (let board of boards) {
    todo += board.todo
    inProgress += board.inProgress
    done += board.done
  }
  return { todo, inProgress, done, total: todo + inProgress + done }
}

function percent(part: number, whole: number) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

export function StatTiles(handle: Handle<{ summary: ProgressSummary }>) {
  return () => {
    let { boards } = handle.props.summary
    let sum = totals(boards)
    let tiles = [
      { label: 'Boards', value: String(boards.length) },
      { label: 'Cards', value: String(sum.total) },
      { label: 'In progress', value: String(sum.inProgress) },
      { label: 'Done', value: `${percent(sum.done, sum.total)}%` },
    ]

    return (
      <dl mix={tilesStyle}>
        {tiles.map((tile) => (
          <div key={tile.label} mix={tileStyle}>
            <dt mix={css({ color: 'var(--text-tertiary)', fontSize: '12px' })}>{tile.label}</dt>
            <dd mix={css({ margin: 0, fontSize: '28px', fontWeight: 700, lineHeight: 1.2 })}>
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
    )
  }
}

// Share of all cards in each stage, as a ring with the completion rate in the middle.
export function CompletionRing(handle: Handle<{ summary: ProgressSummary }>) {
  return () => {
    let sum = totals(handle.props.summary.boards)
    let radius = 52
    let circumference = 2 * Math.PI * radius
    // A 2px surface gap between segments, as long as more than one stage has cards.
    let filled = stages.filter((stage) => sum[stage.key] > 0).length
    let gap = filled > 1 ? 2 : 0
    let offset = 0

    return (
      <figure mix={figureStyle}>
        <svg viewBox="0 0 140 140" width="160" height="160" role="img" aria-label={ringLabel(sum)}>
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--chart-grid)"
            stroke-width="14"
          />
          {sum.total > 0 &&
            stages.map((stage) => {
              let length = (sum[stage.key] / sum.total) * circumference
              let start = offset
              offset += length
              if (length === 0) return null
              return (
                <circle
                  key={stage.key}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={stage.color}
                  stroke-width="14"
                  stroke-dasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
                  stroke-dashoffset={-start}
                  transform="rotate(-90 70 70)"
                  mix={hoverMarkStyle}
                >
                  <title>
                    {stage.label}: {sum[stage.key]} ({percent(sum[stage.key], sum.total)}%)
                  </title>
                </circle>
              )
            })}
          <text x="70" y="68" text-anchor="middle" mix={ringValueStyle}>
            {percent(sum.done, sum.total)}%
          </text>
          <text x="70" y="88" text-anchor="middle" mix={ringCaptionStyle}>
            done
          </text>
        </svg>
        <Legend />
      </figure>
    )
  }
}

function ringLabel(sum: ReturnType<typeof totals>) {
  if (sum.total === 0) return 'No cards yet'
  return stages
    .map((stage) => `${stage.label}: ${sum[stage.key]}`)
    .concat(`${percent(sum.done, sum.total)}% done`)
    .join(', ')
}

// One stacked bar per board, scaled to the busiest board so sizes compare across boards.
export function BoardProgressBars(handle: Handle<{ summary: ProgressSummary }>) {
  return () => {
    let { boards } = handle.props.summary
    let max = Math.max(1, ...boards.map((board) => board.todo + board.inProgress + board.done))

    if (boards.length === 0) {
      return (
        <p mix={emptyStyle}>
          No boards yet. <a href={routes.dashboard.boards.index.href()}>Create one</a> to track
          progress here.
        </p>
      )
    }

    return (
      <figure mix={[figureStyle, css({ alignItems: 'stretch' })]}>
        <ul mix={barListStyle}>
          {boards.map((board) => {
            let total = board.todo + board.inProgress + board.done
            return (
              <li key={board.id} mix={barRowStyle}>
                <a
                  href={routes.dashboard.boards.show.href({ boardId: board.id })}
                  mix={barLabelStyle}
                >
                  {board.name}
                </a>
                <div mix={barTrackStyle}>
                  <div mix={barStyle} style={{ width: `${(total / max) * 100}%` }}>
                    {stages.map((stage) =>
                      board[stage.key] === 0 ? null : (
                        <span
                          key={stage.key}
                          title={`${board.name} · ${stage.label}: ${board[stage.key]}`}
                          mix={[segmentStyle, hoverMarkStyle]}
                          style={{ flexGrow: board[stage.key], background: stage.color }}
                        />
                      ),
                    )}
                  </div>
                </div>
                <span mix={barValueStyle}>
                  {board.done}/{total} done
                </span>
              </li>
            )
          })}
        </ul>
        <Legend />
        <DataTable
          caption="Cards by stage per board"
          headers={['Board', 'To do', 'In progress', 'Done']}
          rows={boards.map((board) => [board.name, board.todo, board.inProgress, board.done])}
        />
      </figure>
    )
  }
}

// Cards created per day. A single series, so the title names it and there is no legend.
export function CreatedChart(handle: Handle<{ summary: ProgressSummary }>) {
  return () => {
    let days = handle.props.summary.createdPerDay
    let max = Math.max(1, ...days.map((day) => day.count))
    let total = days.reduce((sum, day) => sum + day.count, 0)
    let width = 560
    let height = 120
    let top = 6
    let bottom = 2
    let slot = width / days.length
    let barWidth = Math.max(4, slot - 6)
    let plot = height - top - bottom

    return (
      <figure mix={[figureStyle, css({ alignItems: 'stretch', gap: '4px' })]}>
        <span mix={axisLabelsStyle}>Peak: {max} per day</span>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label={`${total} cards created in the last ${days.length} days`}
          mix={css({ display: 'block', overflow: 'visible' })}
        >
          <line
            x1="0"
            x2={width}
            y1={height - bottom}
            y2={height - bottom}
            stroke="var(--chart-grid)"
            stroke-width="1"
          />
          <line
            x1="0"
            x2={width}
            y1={top}
            y2={top}
            stroke="var(--chart-grid)"
            stroke-dasharray="2 4"
          />
          {days.map((day, index) => {
            let h = (day.count / max) * plot
            let x = index * slot + (slot - barWidth) / 2
            return (
              <g key={day.day} mix={hoverMarkStyle}>
                {/* The hit target spans the whole column, not just the bar. */}
                <rect x={index * slot} y={top} width={slot} height={plot} fill="transparent" />
                {day.count > 0 && (
                  <path
                    d={roundedTopBar(x, height - bottom, barWidth, h)}
                    fill="var(--stage-progress)"
                  />
                )}
                <title>
                  {formatDay(day.day)}: {day.count} {day.count === 1 ? 'card' : 'cards'}
                </title>
              </g>
            )
          })}
        </svg>
        {/* Axis labels live in HTML so they keep their size while the SVG scales. */}
        <div mix={axisLabelsStyle}>
          <span>{formatDay(days[0].day)}</span>
          <span>Today</span>
        </div>
        <DataTable
          caption="Cards created per day"
          headers={['Day', 'Cards']}
          rows={days.map((day) => [formatDay(day.day), day.count])}
        />
      </figure>
    )
  }
}

// A bar anchored to the baseline with 4px rounded data-end corners.
function roundedTopBar(x: number, baseline: number, width: number, height: number) {
  let r = Math.min(4, width / 2, height)
  let y = baseline - height
  return [
    `M${x},${baseline}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${baseline}`,
    'Z',
  ].join(' ')
}

function formatDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function Legend() {
  return () => (
    <ul mix={legendStyle}>
      {stages.map((stage) => (
        <li key={stage.key}>
          <span aria-hidden="true" mix={swatchStyle} style={{ background: stage.color }} />
          {stage.label}
        </li>
      ))}
    </ul>
  )
}

function DataTable(
  handle: Handle<{ caption: string; headers: string[]; rows: Array<Array<string | number>> }>,
) {
  return () => {
    let { caption, headers, rows } = handle.props
    return (
      <details mix={detailsStyle}>
        <summary>View as table</summary>
        <table mix={tableStyle}>
          <caption
            mix={css({ textAlign: 'left', padding: '8px 0', color: 'var(--text-tertiary)' })}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={index}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    )
  }
}

const tilesStyle = css({
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '16px',
})

const tileStyle = css({
  padding: '16px 20px',
  borderRadius: '16px',
  background: 'var(--surface-3)',
})

const figureStyle = css({
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '16px',
})

const hoverMarkStyle = css({
  transition: 'opacity 120ms ease',
  '&:hover': { opacity: 0.8 },
})

const ringValueStyle = css({ fill: 'var(--text-primary)', fontSize: '24px', fontWeight: 700 })

const ringCaptionStyle = css({ fill: 'var(--text-tertiary)', fontSize: '12px' })

const emptyStyle = css({
  margin: 0,
  color: 'var(--text-tertiary)',
  '& a': { color: 'var(--brand-blue)' },
})

const barListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
})

const barRowStyle = css({
  display: 'grid',
  gridTemplateColumns: 'minmax(80px, 160px) 1fr auto',
  alignItems: 'center',
  gap: '12px',
  '@media (max-width: 600px)': {
    gridTemplateColumns: '1fr auto',
    '& > :nth-child(2)': { gridColumn: '1 / -1', gridRow: 2 },
  },
})

const barLabelStyle = css({
  color: 'inherit',
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '&:hover': { color: 'var(--brand-blue)' },
})

const barTrackStyle = css({ height: '16px', display: 'flex' })

const barStyle = css({ display: 'flex', gap: '2px', minWidth: '2px' })

const segmentStyle = css({
  flexBasis: 0,
  minWidth: '3px',
  '&:first-child': { borderRadius: '4px 0 0 4px' },
  '&:last-child': { borderRadius: '0 4px 4px 0' },
  '&:only-child': { borderRadius: '4px' },
})

const barValueStyle = css({ color: 'var(--text-tertiary)', fontSize: '12px', whiteSpace: 'nowrap' })

const axisLabelsStyle = css({
  display: 'flex',
  justifyContent: 'space-between',
  color: 'var(--text-tertiary)',
  fontSize: '11px',
})

const legendStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px',
  color: 'var(--text-tertiary)',
  fontSize: '12px',
  '& li': { display: 'flex', alignItems: 'center', gap: '6px' },
})

const swatchStyle = css({ width: '10px', height: '10px', borderRadius: '3px' })

const detailsStyle = css({
  fontSize: '12px',
  color: 'var(--text-tertiary)',
  '& summary': { cursor: 'pointer' },
})

const tableStyle = css({
  width: '100%',
  borderCollapse: 'collapse',
  color: 'var(--text-primary)',
  '& th, & td': {
    padding: '4px 8px',
    textAlign: 'left',
    borderBottom: '1px solid var(--chart-grid)',
    fontWeight: 400,
  },
  '& thead th': { color: 'var(--text-tertiary)' },
  '& td': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
})
