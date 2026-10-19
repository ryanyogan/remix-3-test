import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { ApiPage } from '../api/page.tsx'
import { assets } from '../assets.ts'
import { routes } from '../routes.ts'
import { isTheme, themeCookie } from '../ui/theme.ts'

export default createController(routes, {
  actions: {
    apiGuide(context) { return context.render(<ApiPage />) },
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    home(context) {
      let destination = context.auth.ok ? routes.dashboard.index.href() : routes.login.index.href()
      return redirect(destination, 303)
    },
    // Saves the theme choice. The enhanced toggle posts with fetch and gets a 204; a plain form
    // post is sent back to the page it came from.
    async theme(context) {
      let theme = context.formData.get('theme')
      if (!isTheme(theme)) return new Response('Unknown theme', { status: 400 })

      let headers = { 'Set-Cookie': await themeCookie.serialize(theme) }
      if (context.request.headers.get('Accept')?.includes('application/json')) {
        return new Response(null, { status: 204, headers })
      }
      return redirect(sameOriginReferrer(context.request) ?? routes.home.href(), {
        status: 303,
        headers,
      })
    },
    logout(context) {
      context.session.destroy()
      return redirect(routes.login.index.href(), 303)
    },
  },
})

function sameOriginReferrer(request: Request) {
  let referrer = request.headers.get('Referer')
  if (!referrer || !URL.canParse(referrer)) return null
  let url = new URL(referrer, request.url)
  return url.origin === new URL(request.url).origin ? url.pathname + url.search : null
}
