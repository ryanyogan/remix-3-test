import { requireAuth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import type { User } from '../data/tables.ts'
import type { AppContext } from '../router.ts'
import { routes } from '../routes.ts'
import { SignedOut } from '../ui/public/signed-out.tsx'

// Controller middleware for signed-in pages. Controller middleware does not flow into
// nested route maps, so every controller under routes.dashboard installs it.
export function requireUser() {
  return requireAuth<User>({ onFailure(context) {
    let headers = { 'Cache-Control': 'private, no-store' }
    if (context.request.headers.get('Accept')?.includes('application/json')) {
      return Response.json({ error: 'Sign in to continue' }, { status: 401, headers })
    }
    // A frame would follow the redirect and render the login page inside its region.
    if (context.request.headers.get('X-Remix-Frame') === 'true') {
      // requireAuth types the base context; the router's render middleware has already run.
      return (context as unknown as AppContext).render(<SignedOut href={routes.login.index.href()} />, { status: 401, headers })
    }
    return redirect(routes.login.index.href(), 303)
  } })
}
