import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import type { User } from '../../data/tables.ts'
import type { ProgressSummary } from './boards/data.ts'
import {
  BoardProgressBars,
  chartTokens,
  CompletionRing,
  CreatedChart,
  StatTiles,
} from './charts.tsx'
import { DashboardLayout } from './layout.tsx'

export function OverviewPage(handle: Handle<{ user: User; summary: ProgressSummary }>) {
  return () => {
    let { user, summary } = handle.props

    return (
      <DashboardLayout user={user} title="Overview" current="index">
        <p mix={css({ margin: 0 })}>Welcome back, {user.name.split(/\s+/)[0]}.</p>
        <div mix={[chartTokens, css({ display: 'flex', flexDirection: 'column', gap: '16px' })]}>
          <StatTiles summary={summary} />
          <div mix={gridStyle}>
            <Panel title="Completion">
              <CompletionRing summary={summary} />
            </Panel>
            <Panel title="Progress by board" wide>
              <BoardProgressBars summary={summary} />
            </Panel>
          </div>
          <Panel title="Cards added, last 14 days">
            <CreatedChart summary={summary} />
          </Panel>
          <p mix={css({ margin: 0, color: 'var(--text-tertiary)', fontSize: '12px' })}>
            A card counts as done when it sits in its board's last column, and to do in the first.
          </p>
        </div>
      </DashboardLayout>
    )
  }
}

export function AccountPage(handle: Handle<{ user: User }>) {
  return () => {
    let { user } = handle.props

    return (
      <DashboardLayout user={user} title="Account" current="account">
        <Panel title="Profile">
          <dl mix={css({ margin: 0, display: 'grid', gap: '4px', '& dd': { margin: '0 0 12px' } })}>
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Member since</dt>
            <dd>{new Date(user.created_at).toISOString().slice(0, 10)}</dd>
          </dl>
        </Panel>
      </DashboardLayout>
    )
  }
}

export function Panel(handle: Handle<{ title: string; wide?: boolean; children?: RemixNode }>) {
  return () => (
    <section mix={panelStyle} style={handle.props.wide ? { gridColumn: 'span 2' } : undefined}>
      <h2
        mix={css({
          margin: 0,
          fontSize: '14px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        })}
      >
        {handle.props.title}
      </h2>
      <div>{handle.props.children}</div>
    </section>
  )
}

const gridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '16px',
  '@media (max-width: 760px)': {
    gridTemplateColumns: 'minmax(0, 1fr)',
    '& > *': { gridColumn: 'auto !important' },
  },
})

const panelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '20px',
  borderRadius: '16px',
  background: 'var(--surface-3)',
})
