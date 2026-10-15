import type { Database } from 'remix/data-table'
import { inList } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'

import {
  boardColumns,
  boardItemFiles,
  boardItems,
  boards,
  type Board,
} from '../../../data/tables.ts'
import { limits } from '../../../data/limits.ts'
import type { BoardData } from './public/board-model.ts'

// Columns every new board starts with. The overview charts read the first column as
// "not started" and the last as "done".
export const defaultColumns = ['To do', 'In progress', 'Done']

// Every lookup is scoped to the owner, so another user's board behaves like a missing one.
export function findOwnedBoard(db: Database, userId: string, boardId: string) {
  return db.findOne(boards, { where: { id: boardId, user_id: userId } })
}

export function listBoards(db: Database, userId: string): Promise<Board[]> {
  return db.findMany(boards, { where: { user_id: userId }, orderBy: ['created_at', 'asc'] })
}

export async function loadBoardData(db: Database, board: Board): Promise<BoardData> {
  let [columns, items, files] = await Promise.all([
    db.findMany(boardColumns, { where: { board_id: board.id }, orderBy: ['position', 'asc'] }),
    db.findMany(boardItems, { where: { board_id: board.id }, orderBy: ['position', 'asc'] }),
    db.findMany(boardItemFiles, { where: { board_id: board.id }, orderBy: ['created_at', 'asc'] }),
  ])

  return {
    id: board.id,
    name: board.name,
    color: board.color,
    columns: columns.map((column) => ({
      id: column.id,
      name: column.name,
      position: Number(column.position),
    })),
    items: items.map((item) => ({
      id: item.id,
      columnId: item.column_id,
      title: item.title,
      position: Number(item.position),
      files: files
        .filter((file) => file.item_id === item.id)
        .map((file) => ({ id: file.id, name: file.name, type: file.type, size: file.size })),
    })),
  }
}

// Stores an upload for a card. The storage key is the row id, never the client's file name.
export async function attachFile(
  db: Database,
  storage: FileStorage,
  boardId: string,
  itemId: string,
  values: { id: string; file: File },
): Promise<'attached' | 'missing' | 'full'> {
  let item = await db.find(boardItems, itemId)
  if (item === null || item.board_id !== boardId) return 'missing'
  if (await db.find(boardItemFiles, values.id)) return 'missing'
  let count = await db.count(boardItemFiles, { where: { item_id: item.id } })
  if (count >= limits.filesPerCard) return 'full'

  let { file } = values
  let name = file.name.trim().slice(0, limits.fileName) || 'file'
  // Validate the row before writing bytes, so a rejected upload leaves nothing behind.
  await db.transaction(async (tx) => {
    await tx.create(boardItemFiles, {
      id: values.id,
      board_id: boardId,
      item_id: item.id,
      name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      created_at: Date.now(),
    })
    await storage.set(values.id, file)
  })
  return 'attached'
}

// Removes stored bytes for rows about to disappear, since the database cascade cannot.
export async function removeStoredFiles(
  db: Database,
  storage: FileStorage,
  where: { board_id: string } | { item_id: string } | { id: string },
) {
  let files = await db.findMany(boardItemFiles, { where })
  await Promise.all(files.map((file) => storage.remove(file.id)))
}

export async function createBoard(
  db: Database,
  userId: string,
  values: { name: string; color: string },
): Promise<string> {
  let id = crypto.randomUUID()
  let now = Date.now()

  await db.transaction(async (tx) => {
    await tx.create(boards, { id, user_id: userId, ...values, created_at: now })
    await tx.createMany(
      boardColumns,
      defaultColumns.map((name, index) => ({
        id: crypto.randomUUID(),
        board_id: id,
        name,
        position: index + 1,
        created_at: now,
      })),
    )
  })

  return id
}

// Renames a column, or appends it when the id is new.
export async function upsertColumn(
  db: Database,
  boardId: string,
  values: { id: string; name: string },
): Promise<boolean> {
  let existing = await db.find(boardColumns, values.id)
  if (existing) {
    if (existing.board_id !== boardId) return false
    await db.update(boardColumns, existing.id, { name: values.name })
    return true
  }

  let last = await db.findOne(boardColumns, {
    where: { board_id: boardId },
    orderBy: ['position', 'desc'],
  })
  await db.create(boardColumns, {
    id: values.id,
    board_id: boardId,
    name: values.name,
    position: last ? Number(last.position) + 1 : 1,
    created_at: Date.now(),
  })
  return true
}

// Creates or moves a card. Returns false when the column or an existing card with this id
// belongs to a different board.
export async function upsertItem(
  db: Database,
  boardId: string,
  values: { id: string; columnId: string; title: string; position?: number },
): Promise<boolean> {
  let column = await db.find(boardColumns, values.columnId)
  if (column === null || column.board_id !== boardId) return false

  let position = values.position ?? (await nextItemPosition(db, column.id))
  let existing = await db.find(boardItems, values.id)
  if (existing) {
    if (existing.board_id !== boardId) return false
    await db.update(boardItems, existing.id, {
      column_id: column.id,
      title: values.title,
      position,
    })
    return true
  }

  await db.create(boardItems, {
    id: values.id,
    board_id: boardId,
    column_id: column.id,
    title: values.title,
    position,
    created_at: Date.now(),
  })
  return true
}

async function nextItemPosition(db: Database, columnId: string) {
  let last = await db.findOne(boardItems, {
    where: { column_id: columnId },
    orderBy: ['position', 'desc'],
  })
  return last ? Number(last.position) + 1 : 1
}

export interface BoardProgress {
  id: string
  name: string
  color: string
  todo: number
  inProgress: number
  done: number
}

export interface ProgressSummary {
  boards: BoardProgress[]
  // Cards created per day, oldest first, ending today (UTC).
  createdPerDay: Array<{ day: string; count: number }>
}

// Buckets each card by its column's place on the board: first column, last column, or
// anywhere between. A one-column board has nothing done yet.
export async function loadProgress(
  db: Database,
  userId: string,
  days = 14,
): Promise<ProgressSummary> {
  let userBoards = await listBoards(db, userId)
  let boardIds = userBoards.map((board) => board.id)
  let [columns, items] =
    boardIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.findMany(boardColumns, {
            where: inList('board_id', boardIds),
            orderBy: ['position', 'asc'],
          }),
          db.findMany(boardItems, { where: inList('board_id', boardIds) }),
        ])

  let stageByColumn = new Map<string, keyof Omit<BoardProgress, 'id' | 'name' | 'color'>>()
  for (let board of userBoards) {
    let boardColumnIds = columns.filter((c) => c.board_id === board.id).map((c) => c.id)
    boardColumnIds.forEach((id, index) => {
      let last = index === boardColumnIds.length - 1
      stageByColumn.set(id, index === 0 ? 'todo' : last ? 'done' : 'inProgress')
    })
  }

  let progress = new Map(
    userBoards.map((board) => [
      board.id,
      { id: board.id, name: board.name, color: board.color, todo: 0, inProgress: 0, done: 0 },
    ]),
  )
  for (let item of items) {
    let stage = stageByColumn.get(item.column_id)
    let entry = progress.get(item.board_id)
    if (stage && entry) entry[stage]++
  }

  let dayMs = 24 * 60 * 60 * 1000
  let today = Math.floor(Date.now() / dayMs)
  let createdPerDay = Array.from({ length: days }, (_, index) => ({
    day: new Date((today - days + 1 + index) * dayMs).toISOString().slice(0, 10),
    count: 0,
  }))
  for (let item of items) {
    let offset = Math.floor(item.created_at / dayMs) - (today - days + 1)
    if (offset >= 0 && offset < days) createdPerDay[offset].count++
  }

  return { boards: [...progress.values()], createdPerDay }
}
