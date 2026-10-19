import { dataResponse, privateHeaders } from './data-response.ts'
import { searchCards } from '@trellix/data/operations'
import { loadActivity, loadActivityDay, loadNavigation } from '@trellix/data/activity'
import { createController } from 'remix/router'

import { ActivityTimeline, ActivityMore, ActivityError } from './public/activity.tsx'
import { activityHref, readActivityFilters, activityTimeZone } from './public/activity-urls.ts'

import { requireUser } from '../../middleware/require-user.ts'
import { routes } from '../../routes.ts'
import { readTheme } from '../../ui/theme.ts'
import { loadProgress } from './boards/data.ts'
import { AccountPage, OverviewPage, ActivityContent, InsightsPage, NotificationsPage } from './pages.tsx'

export default createController(routes.dashboard, {
  middleware: [requireUser()],
  actions: {
    navigation: context => dataResponse(context, services => loadNavigation(services.db, services.user.id)),
    search: context => dataResponse(context, async services => Response.json(await searchCards(services, new URL(context.request.url).searchParams), { headers: privateHeaders })),
    async index(context) {
      return context.render(<OverviewPage user={context.auth.identity} theme={await readTheme(context.request)}
        filters={readActivityFilters(new URL(context.request.url))} />, privateResponse)
    },
    async activity(context) {
      let user = context.auth.identity
      let filters = readActivityFilters(new URL(context.request.url))
      let navigation = await loadNavigation(context.db, user.id)
      return context.render(<ActivityContent user={user} navigation={navigation} filters={filters}
        timeZone={requestTimeZone(context.request)} />, privateResponse)
    },
    async activityDay(context) {
      let user = context.auth.identity, url = new URL(context.request.url)
      let filters = readActivityFilters(url), timeZone = requestTimeZone(context.request)
      try {
        let activity = await loadActivityDay(context.db, user.id, filters, timeZone)
        return context.render(<ActivityTimeline activity={activity} userId={user.id}
          hasBoards={url.searchParams.get('hasBoards') !== 'false'} filters={filters}
          timeZone={timeZone} now={filters.before ?? Date.now()} />, privateResponse)
      } catch (error) {
        if (context.request.signal.aborted) throw error
        console.error('Could not load activity day', error)
        return context.render(<ActivityError href={activityHref(routes.dashboard.index.href(), filters)} />, privateResponse)
      }
    },
    async activityMore(context) {
      let url = new URL(context.request.url), filters = readActivityFilters(url)
      return context.render(<ActivityMore
        src={activityHref(routes.dashboard.activityDay.href(), filters, requestTimeZone(context.request))}
        href={activityHref(routes.dashboard.index.href(), filters)} />, privateResponse)
    },
    async insights(context) {
      return context.render(<InsightsPage user={context.auth.identity} theme={await readTheme(context.request)} summary={await loadProgress(context.db, context.auth.identity.id)} />)
    },
    async notifications(context) {
      let user = context.auth.identity
      let params = new URL(context.request.url).searchParams
      let activity = await loadActivity(context.db, user.id, { view: 'notifications', before: Number(params.get('before')) || undefined, beforeId: params.get('beforeId') ?? '' })
      return context.render(<NotificationsPage user={user} theme={await readTheme(context.request)} activity={activity} />)
    },
    async account(context) {
      return context.render(
        <AccountPage user={context.auth.identity} theme={await readTheme(context.request)} />,
      )
    },
  },
})

const privateResponse = { headers: { 'Cache-Control': 'private, no-store' } }
function requestTimeZone(request: Request) {
  let url = new URL(request.url)
  let cookie = /(?:^|;\s*)activity_time_zone=([^;]*)/.exec(request.headers.get('Cookie') ?? '')?.[1]
  let value = url.searchParams.get('tz')
  if (!value && cookie) { try { value = decodeURIComponent(cookie) } catch {} }
  return activityTimeZone(value)
}
