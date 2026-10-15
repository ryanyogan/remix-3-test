import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

export const users = table({
  name: 'users',
  columns: {
    id: c.text(),
    email: c.text(),
    name: c.text(),
    password_hash: c.text(),
    created_at: c.integer(),
  },
})

export type UserRow = TableRow<typeof users>

// The identity exposed to requests; never carries the password hash.
export type User = Omit<UserRow, 'password_hash'>

export const boards = table({
  name: 'boards',
  columns: {
    id: c.text(),
    user_id: c.text(),
    name: c.text(),
    color: c.text(),
    created_at: c.integer(),
  },
})

export type Board = TableRow<typeof boards>

export const boardColumns = table({
  name: 'board_columns',
  columns: {
    id: c.text(),
    board_id: c.text(),
    name: c.text(),
    position: c.decimal(20, 10),
    created_at: c.integer(),
  },
})

export type BoardColumn = TableRow<typeof boardColumns>

export const boardItems = table({
  name: 'board_items',
  columns: {
    id: c.text(),
    board_id: c.text(),
    column_id: c.text(),
    title: c.text(),
    position: c.decimal(20, 10),
    created_at: c.integer(),
  },
})

export type BoardItem = TableRow<typeof boardItems>
