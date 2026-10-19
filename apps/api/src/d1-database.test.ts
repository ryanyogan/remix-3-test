import { DatabaseSync } from 'node:sqlite'
import * as assert from 'remix/assert'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createApi } from './app.ts'
import { sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { boards, users } from '@trellix/data/tables'
import { createD1Database, type D1Like, type D1StatementLike } from '@trellix/data/d1-database'

// A D1 stand-in over node:sqlite with D1's async API and an all-or-nothing batch().
function createFakeD1(): D1Like {
  let sqlite = new DatabaseSync(':memory:')
  sqlite.exec('pragma foreign_keys = on')
  sqlite.exec(`
    create table users (id text primary key, email text not null unique, name text not null,
      password_hash text not null, created_at integer not null);
    create table boards (id text primary key, user_id text not null references users(id),
      name text not null, color text not null, created_at integer not null);
  `)

  function statement(sql: string, values: unknown[] = []): D1StatementLike & { runSync(): void } {
    let prepared = () => sqlite.prepare(sql)
    return {
      bind: (...next) => statement(sql, next),
      async all() {
        let results = prepared().all(...(values as never[])) as Record<string, unknown>[]
        return { results, meta: {} }
      },
      async run() {
        let result = prepared().run(...(values as never[]))
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
      runSync() {
        prepared().run(...(values as never[]))
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
        for (let s of statements) (s as ReturnType<typeof statement>).runSync()
        sqlite.exec('commit')
      } catch (error) {
        sqlite.exec('rollback')
        throw error
      }
      return []
    },
  }
}

const user = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada',
  password_hash: 'x',
  created_at: 1,
}

function board(id: string, userId = 'u1') {
  return { id, user_id: userId, name: 'Board ' + id, color: '#cbd5e1', created_at: 1 }
}

describe('D1 database', () => {
  it('writes and reads rows', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)

    assert.equal((await db.find(users, 'u1'))?.email, 'ada@example.com')
    assert.equal(await db.count(users), 1)
  })

  it('commits transaction writes together', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)

    await db.transaction(async (tx) => {
      await tx.create(boards, board('b1'))
      await tx.createMany(boards, [board('b2'), board('b3')])
      // Queued writes are not visible until the batch commits.
      assert.equal(await tx.count(boards), 0)
    })

    assert.equal(await db.count(boards), 3)
  })

  it('discards transaction writes when the callback throws', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.create(boards, board('b1'))
        throw new Error('nope')
      }),
    )

    assert.equal(await db.count(boards), 0)
  })

  it('rolls back the whole batch when one write fails', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.create(boards, board('b1'))
        await tx.create(boards, board('b2', 'missing-user'))
      }),
    )

    assert.equal(await db.count(boards), 0)
  })

  it('rejects writes that return rows inside a transaction', async () => {
    let db = createD1Database(createFakeD1())

    await assert.rejects(
      db.transaction((tx) => tx.create(users, user, { returnRow: true })),
      /returnRow|cannot return rows|Database execution failed/,
    )
    assert.equal(await db.count(users), 0)
  })
})


describe('D1 raw writes', () => {
  it('queues a raw upsert with a typed write in one batch', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)
    await db.create(boards, board('b1'))
    await db.transaction(async (tx) => {
      await tx.query(boards).where({ id: 'b1' }).update({ name: 'Changed' })
      await tx.exec(sql`insert into boards(id, user_id, name, color, created_at)
        values (${'b2'}, ${'u1'}, ${'New'}, ${'#aabbcc'}, ${1})
        on conflict(id) do update set name = excluded.name`)
    })
    assert.equal((await db.find(boards, 'b1'))?.name, 'Changed')
    assert.equal((await db.find(boards, 'b2'))?.name, 'New')
  })
})


describe('D1 card API', () => {
  it('saves card fields and metadata together without RETURNING in the batch', async () => {
    let db = createD1Database(createFakeD1())
    await db.create(users, user)
    await db.create(boards, board('b1'))
    await db.executeScript(`
      create table card_activity(id text primary key, item_id text, kind text, detail text, created_at integer);
      create table api_tokens(token_hash text primary key, user_id text);
      create table board_columns(id text primary key, board_id text, name text, position real, created_at integer);
      create table board_items(id text primary key, board_id text, column_id text, title text, position real, created_at integer);
      create table card_details(item_id text primary key, description text default '', description_html text default '', assignee_id text, cover_file_id text, tags text default '[]', pinned integer default 0, priority text default 'normal', snoozed_until integer default 0, updated_at integer);
      insert into board_columns values ('c1', 'b1', 'To do', 1, 1);
      insert into board_items values ('i1', 'b1', 'c1', 'Before', 1, 1);
    `)
    let response = await createApi().fetch(new Request('http://localhost/api/v1/boards/b1/cards/i1', {
      method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'After', description: 'Works on D1', pinned: true }),
    }), { db, uploads: createMemoryFileStorage(), sessionUserId: 'u1' })
    assert.equal(response.status, 204)
    let result = await db.exec(sql`select title, description, pinned from board_items i join card_details d on d.item_id = i.id where i.id = ${'i1'}`)
    assert.equal(result.rows?.[0].title, 'After')
    assert.equal(result.rows?.[0].description, 'Works on D1')
    assert.equal(result.rows?.[0].pinned, 1)
  })
})
