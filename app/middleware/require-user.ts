import { requireAuth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import type { User } from '../data/tables.ts'
import { routes } from '../routes.ts'

// Controller middleware for signed-in pages. Controller middleware does not flow into
// nested route maps, so every controller under routes.dashboard installs it.
export function requireUser() {
  return requireAuth<User>({ onFailure: () => redirect(routes.login.index.href(), 303) })
}
