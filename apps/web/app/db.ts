import { fileURLToPath } from 'node:url'
import type { Database } from 'remix/data-table'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createSqliteDatabase } from 'remix/data-table/sqlite'

const defaultFilename = fileURLToPath(new URL('../../../db/app.sqlite', import.meta.url))

export const db = createSqliteDatabase({
  filename: process.env.DATABASE_FILE ?? defaultFilename,
  foreignKeys: true,
})

export async function migrateDatabase(database: Database = db) {
  let migrations = await loadMigrations(
    fileURLToPath(new URL('../../../packages/data/migrations/', import.meta.url)),
  )
  await database.migrate(migrations)
}
