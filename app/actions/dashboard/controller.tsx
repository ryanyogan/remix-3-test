import { createController } from 'remix/router'

import { requireUser } from '../../middleware/require-user.ts'
import { routes } from '../../routes.ts'
import { loadProgress } from './boards/data.ts'
import { AccountPage, OverviewPage } from './pages.tsx'

export default createController(routes.dashboard, {
  middleware: [requireUser()],
  actions: {
    async index(context) {
      let user = context.auth.identity
      return context.render(
        <OverviewPage user={user} summary={await loadProgress(context.db, user.id)} />,
      )
    },
    account(context) {
      return context.render(<AccountPage user={context.auth.identity} />)
    },
  },
})
