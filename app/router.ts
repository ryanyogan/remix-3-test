import { createCookie, type Cookie } from 'remix/cookie'
import type { Database } from 'remix/data-table'
import { auth, createSessionAuthScheme } from 'remix/middleware/auth'
import { formData } from 'remix/middleware/form-data'
import { render } from 'remix/middleware/render'
import { session } from 'remix/middleware/session'
import { staticFiles } from 'remix/middleware/static'
import { createRouter, type RouterContext } from 'remix/router'
import type { SessionStorage } from 'remix/session'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

import controller from './actions/controller.tsx'
import dashboardController from './actions/dashboard/controller.tsx'
import boardsController from './actions/dashboard/boards/controller.tsx'
import loginController from './actions/login/controller.tsx'
import signupController from './actions/signup/controller.tsx'
import { assets } from './assets.ts'
import { users, type User } from './data/tables.ts'
import { db as appDb } from './db.ts'
import { loadDatabase } from './middleware/database.ts'
import { routes } from './routes.ts'

export interface AppRouterOptions {
  db?: Database
  sessionCookie?: Cookie
  sessionStorage?: SessionStorage
}

export function createAppRouter(options: AppRouterOptions = {}) {
  let db = options.db ?? appDb
  let sessionCookie = options.sessionCookie ?? createSessionCookie()
  let sessionStorage = options.sessionStorage ?? createCookieSessionStorage()

  let router = createRouter({
    middleware: [
      staticFiles('./public', { index: false }),
      loadDatabase(db),
      session(sessionCookie, sessionStorage),
      formData(),
      auth({
        schemes: [
          createSessionAuthScheme<User, { userId: string }>({
            read(session) {
              return session.get('auth') as { userId: string } | null
            },
            async verify({ userId }) {
              let user = await db.find(users, userId)
              if (user === null) return null
              let { password_hash: _, ...identity } = user
              return identity
            },
            invalidate(session) {
              session.unset('auth')
            },
          }),
        ],
      }),
      render({ assets }),
    ],
  })

  router.map(routes, controller)
  router.map(routes.login, loginController)
  router.map(routes.signup, signupController)
  router.map(routes.dashboard, dashboardController)
  router.map(routes.dashboard.boards, boardsController)

  return router
}

function createSessionCookie() {
  let secret = process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production')
  }

  return createCookie('__session', {
    secrets: [secret ?? 'dev-only-session-secret'],
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export const router = createAppRouter()

export type AppContext = RouterContext<typeof router>

declare module 'remix' {
  interface RouterTypes {
    context: AppContext
  }
}
