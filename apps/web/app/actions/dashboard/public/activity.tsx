import { clientEntry, type Handle } from 'remix/component'
import type { ActivityEvent, ActivityFilters, ActivityPage, NavigationData } from '@trellix/contracts'
import { ArrowRightIcon, CircleCheckIcon, CommentIcon } from '../../../ui/public/icons.tsx'
import { routes } from '../../../routes.ts'
import { ActivityFilter } from './activity-filter.tsx'
import { activityDays } from './activity-days.ts'

export const ActivityHeading = clientEntry(import.meta.url, function ActivityHeading(handle: Handle<{
  navigation: NavigationData; filters: ActivityFilters; user: { id: string; name: string }
}>) {
  function filter(key: string, value: string) {
    let url = new URL(location.href); url.searchParams.delete('before'); url.searchParams.delete('beforeId')
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    location.assign(url.href)
  }
  return () => {
    let { navigation, filters, user } = handle.props
    let board = navigation.boards.find(b => b.id === filters.board)
    return <div class="activity-heading">
      <h1>{filters.view === 'pinned' ? 'Pinned card activity' : filters.view === 'added' ? 'Cards added by you' : 'Activity'} across{' '}
        <button type="button" id="activity-board-trigger" class="inline-filter" aria-label="Filter activity by board" aria-haspopup="dialog" aria-controls="activity-board" popoverTarget="activity-board">{board?.name ?? 'all boards'}</button>{' '}
        by <button type="button" id="activity-person-trigger" class="inline-filter" aria-label="Filter activity by person" aria-haspopup="dialog" aria-controls="activity-person" popoverTarget="activity-person">{filters.person ? user.name : 'everyone'}</button>
      </h1>
      <ActivityFilter name="board" value={filters.board ?? ''}
        options={[...(filters.board ? [{ value: '', label: 'All boards' }] : []), ...navigation.boards.map(b => ({ value: b.id, label: b.name }))]}
        onSelect={value => filter('board', value)} />
      <ActivityFilter name="person" value={filters.person ?? ''}
        options={[...(filters.person ? [{ value: '', label: 'Everyone' }] : []), { value: user.id, label: user.name }]}
        onSelect={value => filter('person', value)} />
      {filters.tag && <p class="activity-filter-note">Tagged <strong>#{filters.tag}</strong> <a href={routes.dashboard.index.href()} data-rmx-document>Clear filter</a></p>}
    </div>
  }
})

export const ActivityTimeline = clientEntry(import.meta.url, function ActivityTimeline(handle: Handle<{
  activity: ActivityPage; userId: string; hasBoards: boolean; filters: ActivityFilters; now: number
}>) {
  // Stable server HTML, then show dates and times in the reader's own timezone.
  let timeZone = 'UTC'
  handle.queueTask(() => { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; handle.update() })
  return () => {
    let { activity, userId, hasBoards, filters, now } = handle.props
    let days = activityDays(activity.events, now, timeZone, !filters.before)
    let dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
    let timeFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone })
    let filtered = !!(filters.board || filters.tag || filters.person || filters.view)
    let next = new URLSearchParams(Object.entries(filters).filter(([key, value]) => value && key !== 'before' && key !== 'beforeId').map(([k, v]) => [k, String(v)]))
    if (activity.next) { next.set('before', String(activity.next.before)); next.set('beforeId', activity.next.beforeId) }
    return <section class="activity-timeline" aria-label="Board activity">
      {!activity.events.length ? <div class="activity-empty">
        <div class="activity-empty-mark" aria-hidden="true"><span /><span /><span /></div>
        <h2>{!hasBoards ? 'A fresh start.' : filtered ? 'No activity matches this view.' : 'Your next idea starts here.'}</h2>
        <p>{!hasBoards ? 'Add a board, add a card, and make a little progress.' : filters.view === 'pinned' ? 'Pin a card from its details to keep its activity close.' : filtered ? 'Choose another board or return to all activity.' : 'Add your first card. Its story will appear here.'}</p>
        {!hasBoards ? <a class="home-action" href="/dashboard/boards/new" data-rmx-document>Add your first board</a> : filtered ? <a href={routes.dashboard.index.href()} data-rmx-document>View all activity</a> : null}
      </div> : days.map(day => day.kind === 'gap' ? <div class="activity-gap" key={`gap-${day.start}`}><h2>{day.start === day.end ? dateFormat.format(day.start) : `${dateFormat.format(day.start)} – ${dateFormat.format(day.end)}`}</h2><p>No activity for {day.count} {day.count === 1 ? 'day' : 'days'}</p></div> : <section class="activity-day" key={day.date} aria-label={dateFormat.format(day.at)}>
        {(['added', 'updated', 'done'] as const).map(column => {
          let events = day.events.filter(e => (e.kind === 'added' ? 'added' : e.kind === 'done' ? 'done' : 'updated') === column)
          return <div class="activity-column" data-empty={!events.length ? '' : undefined}><h2>{column} {dateFormat.format(day.at)} {events.length > 0 && <span>({events.length})</span>}</h2><div class="activity-events">{events.map(event => <article class="activity-entry" key={event.id}>
            <a class="activity-card" href={routes.dashboard.cards.show.href({ boardId: event.boardId, cardId: event.cardId })} data-rmx-document >
              <div class="activity-card-meta"><span>{event.boardName}</span>{event.kind === 'commented' ? <CommentIcon /> : event.kind === 'done' ? <CircleCheckIcon /> : event.kind === 'moved' ? <ArrowRightIcon /> : null}</div>
              <div class="activity-card-body"><span class="activity-avatar" aria-hidden="true">{initials(event.actorName)}</span><div><strong>{event.actorId === userId ? 'You' : event.actorName} {verb(event)} <u>{event.title}</u>{event.kind === 'moved' && <> to “{event.detail}”</>}</strong>{event.kind === 'commented' && <p>{event.detail}</p>}</div></div>
            </a><time dateTime={new Date(event.at).toISOString()}>{timeFormat.format(event.at)}</time>
          </article>)}</div></div>
        })}
      </section>)}
      {activity.next && <div class="activity-more"><a class="btn btn-ghost" href={`${routes.dashboard.index.href()}?${next}`} data-rmx-document>Older activity <ArrowRightIcon /></a></div>}
      {filters.before && <div class="activity-more"><a href={routes.dashboard.index.href()} data-rmx-document>Back to latest activity</a></div>}
    </section>
  }
})
function initials(name: string) { return name.trim().split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() }
function verb(event: ActivityEvent) { return ({ added: 'added', updated: 'updated', moved: 'moved', done: 'completed', commented: 'commented on' })[event.kind] }
