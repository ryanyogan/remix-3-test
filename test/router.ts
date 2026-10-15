import { DatabaseSync } from 'node:sqlite'
import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { createMemorySessionStorage } from 'remix/session-storage/memory'

import { migrateDatabase } from '../app/db.ts'
import { createAppRouter } from '../app/router.ts'
import { routes } from '../app/routes.ts'

export const origin = 'http://localhost'

// A router backed by a fresh, migrated in-memory database and memory sessions.
export async function createTestRouter() {
  let db = createSqliteDatabase(new DatabaseSync(':memory:'))
  await migrateDatabase(db)

  let router = createAppRouter({
    db,
    sessionCookie: createCookie('session', { secrets: ['test-secret'] }),
    sessionStorage: createMemorySessionStorage(),
  })

  return { db, router }
}

export function getResponseCookie(response: Response, name: string): string {
  let setCookie = response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`))

  assert.ok(setCookie, `Expected a ${name} cookie`)
  return setCookie.split(';', 1)[0]
}

type AppRouter = Awaited<ReturnType<typeof createTestRouter>>['router']

// Signs up a user through the real signup action and returns their session cookie.
export async function signUp(router: AppRouter, email = 'ada@example.com', name = 'Ada Lovelace') {
  let body = new FormData()
  body.set('name', name)
  body.set('email', email)
  body.set('password', 'correct horse')

  let response = await router.fetch(
    new Request(new URL(routes.signup.action.href(), origin), { method: 'POST', body }),
  )
  return getResponseCookie(response, 'session')
}
