import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Like, D1StatementLike } from '@trellix/data/d1-database'

// Exercise the real D1 driver (including queued writes and RETURNING restrictions)
// against the same migrated database used by the SQLite route tests.
export function d1Binding(sqlite: DatabaseSync): D1Like {
  function statement(
    sql: string,
    values: SQLInputValue[] = [],
  ): D1StatementLike & { runSync(): void } {
    return {
      bind: (...next) => statement(sql, next as SQLInputValue[]),
      async all() {
        return { results: sqlite.prepare(sql).all(...values), meta: {} }
      },
      async run() {
        let result = sqlite.prepare(sql).run(...values)
        return {
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        }
      },
      runSync() {
        sqlite.prepare(sql).run(...values)
      },
    }
  }
  return {
    prepare: (sql) => statement(sql),
    async exec(sql) {
      sqlite.exec(sql)
    },
    async batch(statements) {
      sqlite.exec('begin')
      try {
        for (let item of statements) (item as ReturnType<typeof statement>).runSync()
        sqlite.exec('commit')
      } catch (error) {
        sqlite.exec('rollback')
        throw error
      }
      return []
    },
  }
}
