import { loadActivity, loadNavigation } from '@trellix/data/activity'
import { createController } from 'remix/router'

import { requireUser } from '../../middleware/require-user.ts'
import { routes } from '../../routes.ts'
import { readTheme } from '../../ui/theme.ts'
import { loadProgress } from './boards/data.ts'
import { AccountPage, OverviewPage, InsightsPage, NotificationsPage } from './pages.tsx'

export default createController(routes.dashboard, {
  middleware: [requireUser()],
  actions: {
    async index(context) {
      let user = context.auth.identity
      let params = new URL(context.request.url).searchParams
      let filters = {
        board: params.get('board') ?? '', person: params.get('person') ?? '',
        tag: params.get('tag') ?? '', view: params.get('view') ?? '',
        before: Number(params.get('before')) || undefined, beforeId: params.get('beforeId') ?? '',
      }
      let [navigation, activity] = await Promise.all([
        loadNavigation(context.db, user.id), loadActivity(context.db, user.id, filters),
      ])
      return context.render(
        <OverviewPage
          user={user}
          theme={await readTheme(context.request)}
          navigation={navigation}
          activity={activity}
          filters={filters}
        />,
      )
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
