import type { Cookie } from 'remix/cookie'
import { sessionCookie as signedSessionCookie, type SessionAuth } from '@trellix/session'
import type { Database } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'
import { auth, createSessionAuthScheme } from 'remix/middleware/auth'
import { render } from 'remix/middleware/render'
import { session } from 'remix/middleware/session'
import { staticFiles } from 'remix/middleware/static'
import { createRouter, type RouterContext } from 'remix/router'
import { type SessionStorage } from 'remix/session'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

import controller from './actions/controller.tsx'
import dashboardController from './actions/dashboard/controller.tsx'
import boardsController from './actions/dashboard/boards/controller.tsx'
import cardsController from './actions/dashboard/cards/controller.tsx'
import loginController from './actions/login/controller.tsx'
import signupController from './actions/signup/controller.tsx'
import { assets } from './assets.ts'
import { users, type User } from './data/tables.ts'
import { uploads as appUploads } from './data/uploads.ts'
import { db as appDb } from './db.ts'
import { loadDatabase } from './middleware/database.ts'
import { parseFormData } from './middleware/form-data.ts'
import { loadUploads } from './middleware/uploads.ts'
import { routes } from './routes.ts'
import { sameOrigin } from './middleware/same-origin.ts'
import tokensController from './actions/dashboard/tokens/controller.ts'
import uploadsController from './actions/dashboard/uploads/controller.ts'

export interface AppRouterOptions {
  db?: Database
  sessionCookie?: Cookie
  sessionStorage?: SessionStorage
  uploads?: FileStorage
}

export function createAppRouter(options: AppRouterOptions = {}) {
  let db = options.db ?? appDb
  let sessionCookie = options.sessionCookie ?? createSessionCookie()
  let sessionStorage = options.sessionStorage ?? createCookieSessionStorage()
  let uploads = options.uploads ?? appUploads

  let router = createRouter({
    middleware: [
      staticFiles('./public', { index: false }),
      loadDatabase(db),
      loadUploads(uploads),
      session(sessionCookie, sessionStorage),
      sameOrigin(),
      parseFormData(),
      auth({
        schemes: [
          createSessionAuthScheme<User, SessionAuth>({
            read(session) {
              return session.get('auth') as SessionAuth | null
            },
            // A session issued before the user's last sign out carries an older version.
            async verify({ userId, version = 0 }) {
              let user = await db.find(users, userId)
              if (user === null || user.session_version !== version) return null
              let { password_hash: _, session_version: __, ...identity } = user
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
  router.map(routes.dashboard.cards, cardsController)
  router.map(routes.dashboard.tokens, tokensController)
  router.map(routes.dashboard.uploads, uploadsController)

  return router
}

function createSessionCookie() {
  let secret = process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production')
  }

  // Browsers also accept secure cookies from http://localhost, so `pnpm start` keeps working.
  return signedSessionCookie(secret ?? 'dev-only-session-secret', { secure: process.env.NODE_ENV === 'production' })
}

export const router = createAppRouter()

export type AppContext = RouterContext<typeof router>

declare module 'remix' {
  interface RouterTypes {
    context: AppContext
  }
}
