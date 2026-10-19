import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { routes } from '../../routes.ts'
import type { BoardProgress, ProgressSummary } from './boards/data.ts'

// Card stages, from done back to not started: the order the donut and bars draw them in. The
// theme's --viz-* ramp darkens toward "done" in light mode and brightens toward it in dark.
const stages = [
  { key: 'done', label: 'Done', color: 'var(--viz-done)' },
  { key: 'inProgress', label: 'In progress', color: 'var(--viz-prog)' },
  { key: 'todo', label: 'To do', color: 'var(--viz-todo)' },
] as const

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
    let donePercent = percent(sum.done, sum.total)
    let tiles = [
      { label: 'Boards', value: String(boards.length) },
      { label: 'Cards', value: String(sum.total) },
      { label: 'In progress', value: String(sum.inProgress) },
      { label: 'Done', value: `${donePercent}%`, meter: donePercent },
    ]

    return (
      <dl mix={tilesStyle}>
        {tiles.map((tile) => (
          <div key={tile.label} class="panel" mix={tileStyle}>
            <dt class="stat-label">{tile.label}</dt>
            <dd class="stat-value">{tile.value}</dd>
            {tile.meter !== undefined && (
              <dd class="meter" aria-hidden="true">
                <span style={{ width: `${tile.meter}%` }} />
              </dd>
            )}
          </div>
        ))}
      </dl>
    )
  }
}

// Share of all cards in each stage, as a donut with the completion rate in the middle.
export function CompletionDonut(handle: Handle<{ summary: ProgressSummary }>) {
  return () => {
    let sum = totals(handle.props.summary.boards)
    // r = 54 puts the circumference at ~340, the length the theme's `draw` keyframes start from.
    let radius = 54
    let circumference = 2 * Math.PI * radius
    // A small gap between segments, as long as more than one stage has cards.
    let filled = stages.filter((stage) => sum[stage.key] > 0).length
    let gap = filled > 1 ? 3 : 0
    let offset = 0

    return (
      <figure mix={figureStyle}>
        <div mix={donutStyle}>
          <svg class="donut" viewBox="0 0 140 140" role="img" aria-label={donutLabel(sum)}>
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="var(--bg-sunk)"
              stroke-width="16"
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
                    class="seg"
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={stage.color}
                    stroke-width="16"
                    stroke-dasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
                    stroke-dashoffset={-start}
                    transform="rotate(-90 70 70)"
                  >
                    <title>
                      {stage.label}: {sum[stage.key]} ({percent(sum[stage.key], sum.total)}%)
                    </title>
                  </circle>
                )
              })}
          </svg>
          <div aria-hidden="true" mix={donutCenterStyle}>
            <span class="stat-value">{percent(sum.done, sum.total)}%</span>
            <span class="mono">done</span>
          </div>
        </div>
        <Legend />
      </figure>
    )
  }
}

function donutLabel(sum: ReturnType<typeof totals>) {
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
          {boards.map((board, index) => {
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
                  {total > 0 && (
                    <div
                      class="bar-stack"
                      style={{ width: `${(total / max) * 100}%`, '--i': String(index) }}
                    >
                      {stages.map((stage) =>
                        board[stage.key] === 0 ? null : (
                          <span
                            key={stage.key}
                            title={`${board.name} · ${stage.label}: ${board[stage.key]}`}
                            style={{ flex: `${board[stage.key]} 1 0`, background: stage.color }}
                          />
                        ),
                      )}
                    </div>
                  )}
                </div>
                <span class="mono" mix={nowrapStyle}>
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

    return (
      <figure mix={[figureStyle, css({ alignItems: 'stretch', gap: 'var(--s2)' })]}>
        <span class="mono">Peak: {max} per day</span>
        <div
          role="img"
          aria-label={`${total} cards created in the last ${days.length} days`}
          mix={dayChartStyle}
        >
          {days.map((day, index) => (
            <div
              key={day.day}
              title={`${formatDay(day.day)}: ${day.count} ${day.count === 1 ? 'card' : 'cards'}`}
              mix={dayColumnStyle}
            >
              {/* An empty day still gets a 3px tick so the run of days reads as a timeline. */}
              <div
                class="day-bar"
                style={{
                  height: day.count === 0 ? '3px' : `${(day.count / max) * 100}%`,
                  '--i': String(index),
                }}
              />
            </div>
          ))}
        </div>
        <div class="mono" mix={axisLabelsStyle}>
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

function formatDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function Legend() {
  // Listed from not started to done, the order people read progress in.
  return () => (
    <ul class="legend">
      {[...stages].reverse().map((stage) => (
        <li key={stage.key}>
          <i aria-hidden="true" style={{ background: stage.color }} />
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
      <details class="table-toggle">
        <summary>View as table</summary>
        <table class="data-table">
          <caption>{caption}</caption>
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
  gap: 'var(--s4)',
})

const tileStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s2)',
  '& dd': { margin: 0 },
  '& .meter': { marginTop: 'var(--s2)' },
})

const figureStyle = css({
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--s4)',
})

const donutStyle = css({
  position: 'relative',
  width: '180px',
  aspectRatio: '1',
  '& svg': { display: 'block', width: '100%', height: '100%' },
})

const donutCenterStyle = css({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  '& .stat-value': { fontSize: 'var(--text-heading)' },
})

const emptyStyle = css({ margin: 0, color: 'var(--ink-2)' })

const barListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s3)',
})

const barRowStyle = css({
  display: 'grid',
  gridTemplateColumns: 'minmax(80px, 160px) 1fr auto',
  alignItems: 'center',
  gap: 'var(--s3)',
  '@media (max-width: 640px)': {
    gridTemplateColumns: '1fr auto',
    '& > :nth-child(2)': { gridColumn: '1 / -1', gridRow: 2 },
  },
})

const barLabelStyle = css({
  font: '500 var(--text-label) var(--font-body)',
  color: 'var(--ink)',
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '&:hover': { color: 'var(--accent)' },
})

const barTrackStyle = css({ display: 'flex' })

const nowrapStyle = css({ whiteSpace: 'nowrap' })

const dayChartStyle = css({
  display: 'flex',
  alignItems: 'flex-end',
  gap: 'var(--s1)',
  height: 'calc(var(--s8) * 2)',
  borderBottom: '1px solid var(--line)',
})

const dayColumnStyle = css({
  flex: 1,
  height: '100%',
  display: 'flex',
  alignItems: 'flex-end',
  '& .day-bar': { width: '100%' },
})

const axisLabelsStyle = css({ display: 'flex', justifyContent: 'space-between' })
