import { sql, type Database } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'
import { boards, type User, type Board, type BoardItem } from './tables.ts'
import { OperationError } from './operation-errors.ts'

export interface Services {
  db: Database
  uploads: FileStorage
  user: User
}
export interface BoardServices extends Services {
  board: Board
}
export interface CardServices extends BoardServices {
  card: BoardItem
}
export interface StoredDownload {
  file: File
  name?: string
  disposition: 'inline' | 'attachment'
  sandbox?: boolean
}

// Both HTTP entry points must establish ownership before invoking scoped operations.
export async function boardServices(services: Services, boardId: string): Promise<BoardServices> {
  let board = await services.db.findOne(boards, {
    where: { id: boardId, user_id: services.user.id },
  })
  if (!board) throw new OperationError(404, { message: 'Board not found' })
  return { ...services, board }
}

export async function cardServices(
  services: Services,
  boardId: string,
  cardId: string,
): Promise<CardServices> {
  // Resolve both resources together: one indexed round trip after session authentication.
  let result = await services.db.exec(sql`
    select i.*, b.name as board_name, b.color, b.created_at as board_created_at
    from board_items i join boards b on b.id = i.board_id
    where i.id = ${cardId} and b.id = ${boardId} and b.user_id = ${services.user.id}
  `)
  let row = result.rows?.[0]
  if (!row) throw new OperationError(404, { message: 'Card not found' })
  return {
    ...services,
    board: {
      id: boardId,
      user_id: services.user.id,
      name: String(row.board_name),
      color: String(row.color),
      created_at: Number(row.board_created_at),
    },
    card: {
      id: cardId,
      board_id: boardId,
      column_id: String(row.column_id),
      title: String(row.title),
      position: Number(row.position),
      created_at: Number(row.created_at),
    },
  }
}
