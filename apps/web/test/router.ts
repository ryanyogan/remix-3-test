import { DatabaseSync } from 'node:sqlite'
import { createD1Database } from '@trellix/data/d1-database'
import { d1Binding } from './d1.ts'
import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

import { migrateDatabase } from '../app/db.ts'
import { createAppRouter } from '../app/router.ts'
import { routes } from '../app/routes.ts'

export const origin = 'http://localhost'

// A router backed by a fresh, migrated in-memory database, memory uploads, and cookie sessions
// as in production, so a replayed cookie behaves as it would for a real visitor.
export async function createTestRouter(database: 'sqlite' | 'd1' = 'sqlite') {
  let sqlite = new DatabaseSync(':memory:')
  sqlite.exec('pragma foreign_keys = on')
  let local = createSqliteDatabase(sqlite)
  await migrateDatabase(local)
  let db = database === 'd1' ? createD1Database(d1Binding(sqlite)) : local

  let uploads = createMemoryFileStorage()
  let router = createAppRouter({
    db,
    uploads,
    sessionCookie: createCookie('session', { secrets: ['test-secret'] }),
    sessionStorage: createCookieSessionStorage(),
  })

  return { db, router, uploads }
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
