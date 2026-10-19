import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { loadMigrations } from 'remix/data-table/migrations/node'
import type { FileStorage } from 'remix/file-storage'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'
import { sessionCookie } from '@trellix/session'
import { users } from '@trellix/data/tables'
import { createApiHandler } from '../src/handler.ts'

export const origin = 'http://localhost'
export async function createTestRouter(uploads: FileStorage = createMemoryFileStorage()) {
  let db = createSqliteDatabase(new DatabaseSync(':memory:'))
  await db.migrate(await loadMigrations(fileURLToPath(new URL('../../../packages/data/migrations', import.meta.url))))
  let router = { fetch: createApiHandler({ db, uploads, secret: 'test-secret' }), db }
  return { db, uploads, router }
}
export async function signUp(router: Awaited<ReturnType<typeof createTestRouter>>['router'], email = 'ada@example.com', name = 'Ada Lovelace') {
  let id = crypto.randomUUID()
  await router.db.create(users, { id, email, name, password_hash: 'unused-test-fixture', created_at: Date.now() })
  let storage = createCookieSessionStorage()
  let session = await storage.read(null)
  session.set('auth', { userId: id })
  let value = await storage.save(session)
  return (await sessionCookie('test-secret').serialize(JSON.stringify({ value, expires: Date.now() + 3600000 }))).split(';')[0]
}
