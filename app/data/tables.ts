import { column as c, fail, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

import { limits } from './limits.ts'

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

// Table hooks enforce the rules every write must follow, whatever the caller: request
// schemas shape one form's input, these guard the table. Write payloads are partial, so a
// field is checked on create or whenever an update supplies it.
function checkText(
  value: Record<string, unknown>,
  field: string,
  max: number,
  creating: boolean,
  label: string,
) {
  if (!creating && value[field] === undefined) return
  let text = value[field]
  if (typeof text !== 'string' || text.trim().length === 0) {
    return fail(`${label} is required`, [field])
  }
  if (text.length > max) return fail(`${label} must be ${max} characters or fewer`, [field])
}

function checkPosition(value: Record<string, unknown>, creating: boolean) {
  if (!creating && value.position === undefined) return
  if (typeof value.position !== 'number' || !Number.isFinite(value.position)) {
    return fail('Position must be a finite number', ['position'])
  }
}

export const boards = table({
  name: 'boards',
  columns: {
    id: c.text(),
    user_id: c.text(),
    name: c.text(),
    color: c.text(),
    created_at: c.integer(),
  },
  validate({ operation, value }) {
    let creating = operation === 'create'
    let issue = checkText(value, 'name', limits.name, creating, 'Board name')
    if (issue) return issue
    // Board colors are written into inline styles, so only a plain hex color is allowed.
    if ((creating || value.color !== undefined) && !/^#[0-9a-f]{6}$/i.test(String(value.color))) {
      return fail('Color must be a hex value like #9ec5f4', ['color'])
    }
    return { value }
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
  validate({ operation, value }) {
    let creating = operation === 'create'
    return (
      checkText(value, 'name', limits.name, creating, 'Column name') ??
      checkPosition(value, creating) ?? { value }
    )
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
  validate({ operation, value }) {
    let creating = operation === 'create'
    return (
      checkText(value, 'title', limits.cardTitle, creating, 'Card title') ??
      checkPosition(value, creating) ?? { value }
    )
  },
})

export type BoardItem = TableRow<typeof boardItems>

export const boardItemFiles = table({
  name: 'board_item_files',
  columns: {
    id: c.text(),
    board_id: c.text(),
    item_id: c.text(),
    name: c.text(),
    type: c.text(),
    size: c.integer(),
    created_at: c.integer(),
  },
  validate({ operation, value }) {
    let creating = operation === 'create'
    let issue = checkText(value, 'name', limits.fileName, creating, 'File name')
    if (issue) return issue
    if (creating || value.size !== undefined) {
      let size = value.size
      if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
        return fail('File is empty', ['size'])
      }
      if (size > limits.fileBytes) {
        return fail(`Files must be ${limits.fileLabel} or smaller`, ['size'])
      }
    }
    return { value }
  },
})

export type BoardItemFile = TableRow<typeof boardItemFiles>
