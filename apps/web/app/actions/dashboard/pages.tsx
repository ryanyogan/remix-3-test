import { ActivityHeading, ActivityFeed, ActivityLoading } from './public/activity.tsx'
import { NewCardButton } from './public/new-card.tsx'
import type { ActivityFilters, ActivityPage, NavigationData } from '@trellix/contracts'
import { NewBoardButton } from './boards/public/new-board-form.tsx'
import type { Handle, RemixNode } from 'remix/component'
import { css, Frame } from 'remix/component'

import type { User } from '../../data/tables.ts'
import type { Theme } from '../../ui/theme.ts'
import type { ProgressSummary } from './boards/data.ts'
import { BoardProgressBars, CompletionDonut, CreatedChart, StatTiles } from './charts.tsx'
import { ApiTokens, type AccessToken } from './public/api-tokens.tsx'
import { DashboardLayout } from './layout.tsx'
import { routes } from '../../routes.ts'
import { activityHref } from './public/activity-urls.ts'

export function NotificationsPage(handle: Handle<{ user: User; theme?: Theme; activity: ActivityPage }>) {
  return () => <DashboardLayout user={handle.props.user} theme={handle.props.theme} title="Notifications" current="index" home>
    <header class="board-tools-heading"><a href={routes.dashboard.index.href()}>← Home</a><h1>Notifications</h1></header>
    <section class="board-settings-panel">
      <p>New cards on boards you’re watching.</p>
      {handle.props.activity.events.length ? <ul class="board-notifications">{handle.props.activity.events.map(event => <li key={event.id}><a href={routes.dashboard.cards.show.href({ boardId: event.boardId, cardId: event.cardId })}><strong>{event.title}</strong><span>{event.boardName} · {event.actorName}</span></a></li>)}</ul> : <p>You’re all caught up.</p>}
      {handle.props.activity.next && <a href={`${routes.dashboard.notifications.href()}?before=${handle.props.activity.next.before}&beforeId=${encodeURIComponent(handle.props.activity.next.beforeId)}`}>Older notifications</a>}
    </section>
  </DashboardLayout>
}

export function OverviewPage(handle: Handle<{ user: User; theme?: Theme; filters: ActivityFilters }>) {
  return () => {
    let { user, theme, filters } = handle.props
    return <DashboardLayout user={user} theme={theme} current="index" title="Activity" home view={filters.view}>
      <Frame name="home-activity" src={activityHref(routes.dashboard.activity.href(), filters)} fallback={<>
        <div class="home-heading"><NewCardButton boards={[]} /><div class="activity-heading"><h1>Activity</h1></div><NewBoardButton label="Add a board" /></div>
        <ActivityLoading href={activityHref(routes.dashboard.index.href(), filters)} />
      </>} />
    </DashboardLayout>
  }
}

export function ActivityContent(handle: Handle<{ user: User; navigation: NavigationData; filters: ActivityFilters; timeZone: string }>) {
  return () => {
    let { user, navigation, filters, timeZone } = handle.props
    return <>
      <div class="home-heading">
        <NewCardButton boards={navigation.boards} />
        <ActivityHeading navigation={navigation} filters={filters} user={{ id: user.id, name: user.name }} />
        <NewBoardButton label="Add a board" />
      </div>
      <ActivityFeed key={activityHref('', filters)} filters={filters} timeZone={timeZone} hasBoards={!!navigation.boards.length} />
    </>
  }
}


export function InsightsPage(
  handle: Handle<{ user: User; theme?: Theme; summary: ProgressSummary }>,
) {
  return () => {
    let { user, theme, summary } = handle.props

    return (
      <DashboardLayout
        user={user}
        theme={theme}
        title="Insights"
        current="insights"
        meta={<p mix={leadStyle}>Welcome back, {user.name.split(/\s+/)[0]}.</p>}
      >
        <StatTiles summary={summary} />
        <div mix={gridStyle}>
          <Panel title="Completion">
            <CompletionDonut summary={summary} />
          </Panel>
          <Panel title="Progress by board" wide>
            <BoardProgressBars summary={summary} />
          </Panel>
        </div>
        <Panel title="Cards added, last 14 days">
          <CreatedChart summary={summary} />
        </Panel>
        <p mix={footnoteStyle}>
          A card counts as done when it sits in its board's last column, and to do in the first.
        </p>
      </DashboardLayout>
    )
  }
}

export function AccountPage(
  handle: Handle<{ user: User; theme?: Theme; tokens: AccessToken[]; secret?: string; error?: string }>,
) {
  return () => {
    let { user, theme, tokens, secret, error } = handle.props

    return (
      <DashboardLayout user={user} theme={theme} title="Account" current="account">
        <Panel title="Profile">
          <dl mix={profileStyle}>
            <dt class="stat-label">Name</dt>
            <dd>{user.name}</dd>
            <dt class="stat-label">Email</dt>
            <dd>{user.email}</dd>
            <dt class="stat-label">Member since</dt>
            <dd class="mono">{new Date(user.created_at).toISOString().slice(0, 10)}</dd>
          </dl>
        </Panel>
        <ApiTokens tokens={tokens} secret={secret} error={error} />
      </DashboardLayout>
    )
  }
}

export function Panel(handle: Handle<{ title: string; wide?: boolean; children?: RemixNode }>) {
  return () => (
    <section class="panel" mix={[panelStyle, handle.props.wide && wideStyle]}>
      <h2 mix={panelTitleStyle}>{handle.props.title}</h2>
      <div>{handle.props.children}</div>
    </section>
  )
}

const leadStyle = css({ margin: 0, color: 'var(--ink-2)' })

const gridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 'var(--s4)',
  '@media (max-width: 860px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
})

const panelStyle = css({ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' })

const wideStyle = css({
  gridColumn: 'span 2',
  '@media (max-width: 860px)': { gridColumn: 'auto' },
})

const panelTitleStyle = css({ fontSize: 'var(--text-title)' })

const footnoteStyle = css({
  margin: 0,
  font: '400 var(--text-label) var(--font-body)',
  color: 'var(--ink-3)',
})

const profileStyle = css({
  margin: 0,
  display: 'grid',
  gap: 'var(--s1)',
  '& dd': { margin: '0 0 var(--s3)' },
})
