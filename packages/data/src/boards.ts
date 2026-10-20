import type { Database } from 'remix/data-table'
import { sql } from 'remix/data-table'
import { claimEditorFiles, type EditorFile } from './editor-uploads.ts'
import { movementKind, recordActivity } from './activity.ts'
import type { FileStorage } from 'remix/file-storage'

import {
  boardColumns,
  boardItemFiles,
  boardItems,
  boards,
  type Board,
} from './tables.ts'
import { limits } from './limits.ts'
import type { BoardData, ColumnColor } from '@trellix/contracts'

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

// Card pages only need their board's columns, not every card and attachment on it.
export async function loadBoardColumns(db: Database, boardId: string): Promise<BoardData['columns']> {
  let [columns, colors] = await Promise.all([
    db.findMany(boardColumns, { where: { board_id: boardId }, orderBy: ['position', 'asc'] }),
    db.exec(sql`select c.column_id, c.color from column_colors c join board_columns bc on bc.id = c.column_id where bc.board_id = ${boardId}`),
  ])
  return columns.map(column => ({
    id: column.id,
    name: column.name,
    color: String(colors.rows?.find(row => row.column_id === column.id)?.color ?? 'yellow') as ColumnColor,
    position: Number(column.position),
  }))
}

export async function loadBoardData(db: Database, board: Board): Promise<BoardData> {
  let [columns, items, files, metadata, watch] = await Promise.all([
    loadBoardColumns(db, board.id),
    db.findMany(boardItems, { where: { board_id: board.id }, orderBy: ['position', 'asc'] }),
    db.findMany(boardItemFiles, { where: { board_id: board.id }, orderBy: ['created_at', 'asc'] }),
    db.exec(sql`select i.id, u.name as author, d.assignee_id,
      max(i.created_at, coalesce(d.updated_at, 0), coalesce((select max(a.created_at) from card_activity a where a.item_id = i.id), 0)) as updated_at,
      coalesce(d.tags, '[]') as tags, coalesce(d.pinned, 0) as pinned,
      coalesce(d.priority, 'normal') as priority, coalesce(d.snoozed_until, 0) as snoozed_until,
      length(coalesce(d.description, '')) > 0 as has_description,
      (select count(*) from card_steps s where s.item_id = i.id) as steps,
      (select count(*) from card_steps s where s.item_id = i.id and s.completed = 1) as completed_steps,
      (select count(*) from card_comments c where c.item_id = i.id) as comments
      from board_items i join boards b on b.id = i.board_id join users u on u.id = b.user_id
      left join card_details d on d.item_id = i.id where i.board_id = ${board.id}`),
    db.exec(sql`select watching from board_watches where board_id = ${board.id}`),
  ])

  let authors = new Map((metadata.rows ?? []).map(row => [String(row.id), { author: String(row.author), assigneeId: row.assignee_id ? String(row.assignee_id) : null, updatedAt: Number(row.updated_at) }]))

  let details = new Map((metadata.rows ?? []).map((row) => [String(row.id), {
    tags: JSON.parse(String(row.tags)) as string[], pinned: Boolean(row.pinned),
    priority: String(row.priority), snoozedUntil: Number(row.snoozed_until),
    hasDescription: Boolean(row.has_description), steps: Number(row.steps),
    completedSteps: Number(row.completed_steps), comments: Number(row.comments),
  }]))
  let filesByItem = new Map<string, typeof files>()
  for (let file of files) {
    let group = filesByItem.get(file.item_id) ?? []
    group.push(file)
    filesByItem.set(file.item_id, group)
  }
  return {
    id: board.id,
    name: board.name,
    color: board.color,
    watching: watch.rows?.[0]?.watching !== 0,
    columns,
    items: items.map((item) => ({
      id: item.id,
      columnId: item.column_id,
      title: item.title,
      createdAt: Number(item.created_at),
      ...authors.get(item.id),
      position: Number(item.position),
      detail: details.get(item.id),
      files: (filesByItem.get(item.id) ?? [])
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
  // Validate the row before writing bytes, so a rejected upload leaves nothing behind. D1 only
  // queues the insert and commits it after the callback, so a failed commit must also remove
  // the bytes already stored.
  let stored = false
  try {
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
      stored = true
    })
  } catch (error) {
    if (stored) await storage.remove(values.id)
    throw error
  }
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
  values: { name: string },
): Promise<string> {
  let id = crypto.randomUUID()
  let now = Date.now()

  await db.transaction(async (tx) => {
    // Retain the legacy database field for compatibility; boards no longer have custom colors.
    await tx.create(boards, { id, user_id: userId, name: values.name, color: '#cbd5e1', created_at: now })
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
  values: { id: string; name: string; color?: ColumnColor },
): Promise<boolean> {
  let existing = await db.find(boardColumns, values.id)
  if (existing) {
    if (existing.board_id !== boardId) return false
    await db.transaction(async tx => {
      // D1 batches cannot return rows; Database.update() implicitly requests RETURNING.
      await tx.query(boardColumns).where({ id: existing.id }).update({ name: values.name })
      if (values.color) await tx.exec(sql`insert into column_colors(column_id, color) values (${existing.id}, ${values.color}) on conflict(column_id) do update set color = excluded.color`)
    })
    return true
  }

  let tail = await db.findMany(boardColumns, {
    where: { board_id: boardId },
    orderBy: ['position', 'desc'],
    limit: 2,
  })
  await db.transaction(async tx => {
    await tx.create(boardColumns, {
      id: values.id,
      board_id: boardId,
      name: values.name,
      position: values.name.toLowerCase() === 'not now' ? 0
        : tail.length === 2 ? (Number(tail[0].position) + Number(tail[1].position)) / 2
        : tail[0] ? Number(tail[0].position) + 1 : 1,
      created_at: Date.now(),
    })
    await tx.exec(sql`insert into column_colors(column_id, color) values (${values.id}, ${values.color ?? 'blue'})`)
  })
  return true
}

// Column removal preserves cards and attachments by returning them to intake.
export async function deleteColumn(db: Database, _storage: FileStorage, boardId: string, columnId: string): Promise<void> {
  let columns = await db.findMany(boardColumns, { where: { board_id: boardId }, orderBy: ['position', 'asc'] })
  if (!columns.some(column => column.id === columnId)) return
  let intake = columns.find(column => column.id !== columnId && column.name.toLowerCase() !== 'not now')
  if (!intake) return // A board must keep a destination for its cards.
  let tail = await nextItemPosition(db, intake.id)
  let items = await db.findMany(boardItems, { where: { column_id: columnId }, orderBy: ['position', 'asc'] })
  await db.transaction(async tx => {
    for (let [index, item] of items.entries()) {
      await tx.query(boardItems).where({ id: item.id }).update({ column_id: intake.id, position: tail + index })
      await recordActivity(tx, item.id, 'moved', intake.name)
    }
    await tx.delete(boardColumns, columnId)
  })
}

// Only work columns may trade places: intake and Done keep their semantic positions.
export async function moveColumn(db: Database, boardId: string, columnId: string, direction: 'left' | 'right'): Promise<boolean> {
  let columns = (await db.findMany(boardColumns, { where: { board_id: boardId }, orderBy: ['position', 'asc'] })).filter(column => column.name.toLowerCase() !== 'not now')
  let work = columns.slice(1, -1)
  let index = work.findIndex(column => column.id === columnId)
  let neighbor = work[index + (direction === 'left' ? -1 : 1)]
  if (index < 0 || !neighbor) return false
  let column = work[index]
  await db.transaction(async tx => {
    await tx.query(boardColumns).where({ id: column.id }).update({ position: neighbor.position })
    await tx.query(boardColumns).where({ id: neighbor.id }).update({ position: column.position })
  })
  return true
}

// Creates or moves a card. Returns false when the column or an existing card with this id
// belongs to a different board.
export async function upsertItem(
  db: Database,
  boardId: string,
  values: { id: string; columnId: string; title: string; position?: number; description?: { html: string; text: string }; tags?: string[]; assigneeId?: string | null; steps?: { title: string; completed: boolean }[]; uploads?: { userId: string; files: EditorFile[] } },
): Promise<boolean> {
  let column = await db.find(boardColumns, values.columnId)
  if (column === null || column.board_id !== boardId) return false

  let position = values.position ?? (await nextItemPosition(db, column.id))
  let existing = await db.find(boardItems, values.id)
  if (existing) {
    if (existing.board_id !== boardId) return false
    let moved = existing.column_id !== column.id
    let kind = moved ? await movementKind(db, boardId, column.id) : 'updated' as const
    await db.transaction(async tx => {
      await tx.query(boardItems).where({ id: existing.id }).update({ column_id: column.id, title: values.title, position })
      await tx.exec(sql`insert into card_details(item_id, updated_at) values (${existing.id}, ${Date.now()})
        on conflict(item_id) do update set updated_at = excluded.updated_at`)
      if (values.description) await tx.exec(sql`update card_details set description = ${values.description.text}, description_html = ${values.description.html} where item_id = ${existing.id}`)
      if (values.tags !== undefined) await tx.exec(sql`update card_details set tags = ${JSON.stringify(values.tags)} where item_id = ${existing.id}`)
      if (values.assigneeId !== undefined) await tx.exec(sql`update card_details set assignee_id = ${values.assigneeId} where item_id = ${existing.id}`)
      // Creation retries use the same client id and complete draft payload.
      if (values.steps !== undefined) {
        await tx.exec(sql`delete from card_steps where item_id = ${existing.id}`)
        let started = Date.now()
        for (let [index, step] of values.steps.entries()) await tx.exec(sql`insert into card_steps(id, item_id, title, completed, created_at)
          values (${crypto.randomUUID()}, ${existing.id}, ${step.title}, ${step.completed ? 1 : 0}, ${started + index})`)
      }
      if (values.uploads) await claimEditorFiles(tx, values.uploads.userId, boardId, values.id, values.uploads.files)
      if (moved || existing.title !== values.title || values.description) await recordActivity(tx, existing.id, kind, moved ? column.name : '')
    })
    return true
  }

  await db.transaction(async tx => {
    await tx.create(boardItems, {
      id: values.id, board_id: boardId, column_id: column.id,
      title: values.title, position, created_at: Date.now(),
    })
    if (values.description || values.tags || values.assigneeId || values.steps) {
      await tx.exec(sql`insert into card_details(item_id, description, description_html, tags, assignee_id, updated_at)
        values (${values.id}, ${values.description?.text ?? ''}, ${values.description?.html ?? ''}, ${JSON.stringify(values.tags ?? [])}, ${values.assigneeId ?? null}, ${Date.now()})`)
    }
    if (values.uploads) await claimEditorFiles(tx, values.uploads.userId, boardId, values.id, values.uploads.files)
    let started = Date.now()
    for (let [index, step] of (values.steps ?? []).entries()) await tx.exec(sql`insert into card_steps(id, item_id, title, completed, created_at)
      values (${crypto.randomUUID()}, ${values.id}, ${step.title}, ${step.completed ? 1 : 0}, ${started + index})`)
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
  let dayMs = 24 * 60 * 60 * 1000
  let today = Math.floor(Date.now() / dayMs)
  let [counts, daily] = await Promise.all([
    db.exec(sql`select b.id, b.name, b.color,
      sum(case when co.name = 'Not Now' or i.column_id = (select id from board_columns where board_id = b.id and lower(name) != 'not now' order by position, id limit 1) then 1 else 0 end) as todo,
      sum(case when co.name != 'Not Now' and i.column_id != (select id from board_columns where board_id = b.id and lower(name) != 'not now' order by position, id limit 1)
        and i.column_id != (select id from board_columns where board_id = b.id order by position desc, id desc limit 1) then 1 else 0 end) as inProgress,
      sum(case when co.name != 'Not Now' and i.column_id != (select id from board_columns where board_id = b.id and lower(name) != 'not now' order by position, id limit 1)
        and i.column_id = (select id from board_columns where board_id = b.id order by position desc, id desc limit 1) then 1 else 0 end) as done
      from boards b left join board_items i on i.board_id = b.id left join board_columns co on co.id = i.column_id
      where b.user_id = ${userId} group by b.id order by b.created_at`),
    db.exec(sql`select cast(i.created_at / ${dayMs} as integer) as day, count(*) as count
      from boards b join board_items i on i.board_id = b.id
      where b.user_id = ${userId} and i.created_at >= ${(today - days + 1) * dayMs}
      group by day`),
  ])
  let byDay = new Map((daily.rows ?? []).map((row) => [Number(row.day), Number(row.count)]))
  return {
    boards: (counts.rows ?? []).map((row) => ({
      id: String(row.id), name: String(row.name), color: String(row.color),
      todo: Number(row.todo), inProgress: Number(row.inProgress), done: Number(row.done),
    })),
    createdPerDay: Array.from({ length: days }, (_, index) => ({
      day: new Date((today - days + 1 + index) * dayMs).toISOString().slice(0, 10),
      count: byDay.get(today - days + 1 + index) ?? 0,
    })),
  }
}
