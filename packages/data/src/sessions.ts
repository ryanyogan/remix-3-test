import { sql, type Database } from 'remix/data-table'

// Invalidates every session issued to the user: sessions carry the session_version they were
// issued with, and the web and API auth checks reject a version that no longer matches.
export async function revokeSessions(db: Database, userId: string) {
  await db.exec(sql`update users set session_version = session_version + 1 where id = ${userId}`)
}
