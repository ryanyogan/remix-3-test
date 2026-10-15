import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { routes } from '../routes.ts'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    home(context) {
      let destination = context.auth.ok ? routes.dashboard.index.href() : routes.login.index.href()
      return redirect(destination, 303)
    },
    logout(context) {
      context.session.destroy()
      return redirect(routes.login.index.href(), 303)
    },
  },
})
