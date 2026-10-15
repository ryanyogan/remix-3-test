import { createContextKey } from 'remix/router'
import type { Database } from 'remix/data-table'
import type { Middleware } from 'remix/router'

export const databaseContext = createContextKey<Database>()

export function loadDatabase(db: Database): Middleware<{
  key: typeof databaseContext
  value: Database
  property: 'db'
}> {
  return (context, next) => {
    context.set(databaseContext, db, { property: 'db' })
    return next()
  }
}
