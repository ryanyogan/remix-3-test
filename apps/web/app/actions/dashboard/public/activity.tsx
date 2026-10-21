import { clientEntry, Frame, navigate, on, ref, type Handle } from 'remix/component'
import type { ActivityEvent, ActivityFilters, ActivityPage, NavigationData } from '@trellix/contracts'
import { ArrowRightIcon, CircleCheckIcon, CommentIcon } from '../../../ui/public/icons.tsx'
import { routes } from '../../../routes.ts'
import { SearchPicker } from '../../../ui/public/search-picker.tsx'
import { activityDays } from './activity-days.ts'
import { activityHref } from './activity-urls.ts'

export const ActivityHeading = clientEntry(import.meta.url, function ActivityHeading(handle: Handle<{
  navigation: NavigationData; filters: ActivityFilters; user: { id: string; name: string }
}>) {
  let pending = false, error = ''
  async function filter(key: string, value: string) {
    let url = new URL(location.href); url.searchParams.delete('before'); url.searchParams.delete('beforeId')
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    pending = true; error = ''; handle.update()
    try { await navigate(url.href, { target: 'home-activity', src: routes.dashboard.activity.href() + url.search, resetScroll: false }) }
    catch { error = 'Could not update activity. Please try again.' }
    finally { if (!handle.signal.aborted) { pending = false; handle.update() } }
  }
  return () => {
    let { navigation, filters, user } = handle.props
    let board = navigation.boards.find(b => b.id === filters.board)
    return <div class="activity-heading" aria-busy={pending}>
      <h1>{filters.view === 'pinned' ? 'Pinned card activity' : filters.view === 'added' ? 'Cards added by you' : 'Activity'} across{' '}
        <SearchPicker id="activity-board" class="activity-filter-popover" placement="bottom" title="Board…" label="Filter boards"
          empty={query => query ? 'No boards found.' : 'No boards yet.'}
          options={[...(filters.board ? [{ value: '', label: 'All boards' }] : []), ...navigation.boards.map(b => ({ value: b.id, label: b.name, selected: b.id === filters.board }))]}
          onSelect={value => filter('board', value)}
          trigger={mix => <button type="button" class="inline-filter" aria-label="Filter activity by board" mix={[mix.anchor, mix.trigger]}>{board?.name ?? 'all boards'}</button>} />{' '}
        by <SearchPicker id="activity-person" class="activity-filter-popover" placement="bottom" title="Person…" label="Filter people"
          empty={query => query ? 'No people found.' : 'No people yet.'}
          options={[...(filters.person ? [{ value: '', label: 'Everyone' }] : []), { value: user.id, label: user.name, selected: user.id === filters.person }]}
          onSelect={value => filter('person', value)}
          trigger={mix => <button type="button" class="inline-filter" aria-label="Filter activity by person" mix={[mix.anchor, mix.trigger]}>{filters.person ? user.name : 'everyone'}</button>} />
      </h1>
      {error && <p role="alert">{error}</p>}
      {filters.tag && <p class="activity-filter-note">Tagged <strong>#{filters.tag}</strong> <a href={routes.dashboard.index.href()} data-rmx-target="home-activity" data-rmx-src={routes.dashboard.activity.href()}>Clear filter</a></p>}
    </div>
  }
})

export const ActivityTimeline = clientEntry(import.meta.url, function ActivityTimeline(handle: Handle<{
  activity: ActivityPage; userId: string; hasBoards: boolean; filters: ActivityFilters; now: number; timeZone: string
}>) {
  return () => {
    let { activity, userId, hasBoards, filters, now, timeZone } = handle.props
    let days = activityDays(activity.events, now, timeZone)
    let dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
    let timeFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone })
    let filtered = !!(filters.board || filters.tag || filters.person || filters.view)
    let next = activity.next ? { ...filters, ...activity.next } : undefined
    return <div class="activity-page" data-activity-cursor={filters.beforeId || 'latest'}>
      {!activity.events.length && filters.before ? <p class="activity-more">No older activity.</p> : !activity.events.length ? <div class="activity-empty">
        <div class="activity-empty-mark" aria-hidden="true"><span /><span /><span /></div>
        <h2>{!hasBoards ? 'A fresh start.' : filtered ? 'No activity matches this view.' : 'Your next idea starts here.'}</h2>
        <p>{!hasBoards ? 'Add a board, add a card, and make a little progress.' : filters.view === 'pinned' ? 'Pin a card from its details to keep its activity close.' : filtered ? 'Choose another board or return to all activity.' : 'Add your first card. Its story will appear here.'}</p>
        {!hasBoards ? <a class="home-action" href={routes.dashboard.boards.new.href()}>Add your first board</a> : filtered ? <a href={routes.dashboard.index.href()} data-rmx-target="home-activity" data-rmx-src={routes.dashboard.activity.href()}>View all activity</a> : null}
      </div> : days.map(day => day.kind === 'gap' ? <div class="activity-gap" key={`gap-${day.start}`}><h2>{day.start === day.end ? dateFormat.format(day.start) : `${dateFormat.format(day.start)} – ${dateFormat.format(day.end)}`}</h2><p>No activity for {day.count} {day.count === 1 ? 'day' : 'days'}</p></div> : <section class="activity-day" key={day.date} aria-label={dateFormat.format(day.at)}>
        {(['added', 'updated', 'done'] as const).map(column => {
          let events = day.events.filter(e => (e.kind === 'added' ? 'added' : e.kind === 'done' ? 'done' : 'updated') === column)
          return <div class="activity-column" data-empty={!events.length ? '' : undefined}><h2>{column} {dateFormat.format(day.at)}{filters.before && dateFormat.format(filters.before) === dateFormat.format(day.at) && <span> · continued</span>} {events.length > 0 && <span>({events.length})</span>}</h2><div class="activity-events">{events.map(event => <article class="activity-entry" data-event-id={event.id} key={event.id}>
            <a class="activity-card" href={routes.dashboard.cards.show.href({ boardId: event.boardId, cardId: event.cardId })}>
              <div class="activity-card-meta"><span>{event.boardName}</span>{event.kind === 'commented' ? <CommentIcon /> : event.kind === 'done' ? <CircleCheckIcon /> : event.kind === 'moved' ? <ArrowRightIcon /> : null}</div>
              <div class="activity-card-body"><span class="activity-avatar" aria-hidden="true">{initials(event.actorName)}</span><div><strong>{event.actorId === userId ? 'You' : event.actorName} {verb(event)} <u>{event.title}</u>{event.kind === 'moved' && <> to “{event.detail}”</>}</strong>{event.kind === 'commented' && <p>{event.detail}</p>}</div></div>
            </a><time dateTime={new Date(event.at).toISOString()}>{timeFormat.format(event.at)}</time>
          </article>)}</div></div>
        })}
      </section>)}
      {next && <Frame src={activityHref(routes.dashboard.activityMore.href(), next, timeZone)} />}
    </div>
  }
})
function initials(name: string) { return name.trim().split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() }
function verb(event: ActivityEvent) { return ({ added: 'added', updated: 'updated', moved: 'moved', done: 'completed', commented: 'commented on' })[event.kind] }


// Changing a filter replaces this keyed feed, disposing in-flight older-day requests.
export const ActivityFeed = clientEntry(import.meta.url, function ActivityFeed(handle: Handle<{
  filters: ActivityFilters; timeZone: string; hasBoards: boolean
}>) {
  let timeZone = handle.props.timeZone
  handle.queueTask(() => {
    let local = Intl.DateTimeFormat().resolvedOptions().timeZone
    document.cookie = `activity_time_zone=${encodeURIComponent(local)}; Path=/; SameSite=Lax; Max-Age=31536000`
    if (local !== timeZone) { timeZone = local; handle.update() }
  })
  return () => {
    let { filters, hasBoards } = handle.props
    let href = activityHref(routes.dashboard.index.href(), filters)
    let src = activityHref(routes.dashboard.activityDay.href(), filters, timeZone)
    return <section class="activity-timeline" aria-label="Board activity">
      <Frame key={src} src={src + `&hasBoards=${hasBoards}`} fallback={<ActivityLoading href={href} />} />
      {filters.before && <div class="activity-more"><a href={routes.dashboard.index.href()} data-rmx-target="home-activity" data-rmx-src={routes.dashboard.activity.href()}>Back to latest activity</a></div>}
    </section>
  }
})

export function ActivityLoading(handle: Handle<{ href: string }>) {
  return () => <div class="activity-loading" role="status">
    <div class="activity-loading-columns" aria-hidden="true">{[0, 1, 2].map(i => <div key={i}><span /><span /><span /></div>)}</div>
    <p>Loading activity… <a href={handle.props.href} data-rmx-document>Reload activity</a></p>
  </div>
}

export const ActivityMore = clientEntry(import.meta.url, function ActivityMore(handle: Handle<{ src: string; href: string }>) {
  let anchor: HTMLAnchorElement | undefined, observer: IntersectionObserver | undefined
  let loading = false, error = ''
  async function load() {
    if (loading) return
    observer?.disconnect()
    loading = true; error = ''; handle.update()
    try {
      handle.frame.src = handle.props.src
      await handle.frame.reload()
    } catch {
      if (!handle.signal.aborted) error = 'Could not load older activity. Try again.'
    } finally {
      if (!handle.signal.aborted) { loading = false; handle.update() }
    }
  }
  handle.queueTask(() => {
    if (!anchor || !('IntersectionObserver' in window)) return
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load()
    }, { rootMargin: '300px' })
    observer.observe(anchor)
    handle.signal.addEventListener('abort', () => observer?.disconnect(), { once: true })
  })
  return () => <div class="activity-more" aria-busy={loading}>
    <a class="btn btn-ghost" href={handle.props.href} data-rmx-document mix={[
      ref(node => { anchor = node }), on('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault(); void load()
      }),
    ]}>{loading ? 'Loading older activity…' : error || 'Older activity'} <ArrowRightIcon /></a>
    {error && <span class="sr-only" role="alert">{error}</span>}
  </div>
})

export const ActivityError = clientEntry(import.meta.url, function ActivityError(handle: Handle<{ href: string }>) {
  let loading = false
  return () => <p class="activity-more" role="alert">Could not load activity. <a href={handle.props.href} data-rmx-document aria-busy={loading} mix={on('click', async event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (loading) return
    loading = true; handle.update()
    try { await handle.frame.reload() } catch {} finally { if (!handle.signal.aborted) { loading = false; handle.update() } }
  })}>Try again</a></p>
})
