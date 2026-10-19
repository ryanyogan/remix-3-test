import { sql, type Database } from 'remix/data-table'
import type { CardDetailData } from '@trellix/contracts'

// Callers establish board ownership first; the item is still scoped to that board.
export async function loadCard(db: Database, boardId: string, cardId: string): Promise<CardDetailData | null> {
  let [detail, steps, comments, files] = await Promise.all([
    db.exec(sql`select i.id, i.title, i.column_id, i.position, i.created_at, u.name as author,
      coalesce(d.updated_at, i.created_at) as updated_at,
      coalesce(d.description, '') as description, coalesce(d.description_html, '') as description_html,
      d.assignee_id, d.cover_file_id, coalesce(d.tags, '[]') as tags, coalesce(d.priority, 'normal') as priority,
      coalesce(d.pinned, 0) as pinned, coalesce(d.snoozed_until, 0) as snoozed_until
      from board_items i join boards b on b.id = i.board_id join users u on u.id = b.user_id
      left join card_details d on d.item_id = i.id where i.id = ${cardId} and i.board_id = ${boardId}`),
    db.exec(sql`select id, title, completed from card_steps where item_id = ${cardId} order by created_at, id limit 200`),
    db.exec(sql`select c.id, c.body, c.body_html, c.created_at, u.name as author from card_comments c
      join users u on u.id = c.user_id where c.item_id = ${cardId} order by c.created_at desc, c.id desc limit 100`),
    db.exec(sql`select id, name, type, size from board_item_files where item_id = ${cardId} order by created_at, id`),
  ])
  let row = detail.rows?.[0]
  if (!row) return null
  return {
    assignee_id: row.assignee_id == null ? null : String(row.assignee_id), cover_file_id: row.cover_file_id == null ? null : String(row.cover_file_id),
    position: Number(row.position), id: String(row.id), title: String(row.title), column_id: String(row.column_id),
    created_at: Number(row.created_at), updated_at: Number(row.updated_at), author: String(row.author),
    description: String(row.description), description_html: String(row.description_html),
    tags: JSON.parse(String(row.tags)), priority: String(row.priority), pinned: Number(row.pinned), snoozed_until: Number(row.snoozed_until),
    steps: (steps.rows ?? []).map(r => ({ id: String(r.id), title: String(r.title), completed: Number(r.completed) })),
    comments: (comments.rows ?? []).map(r => ({ id: String(r.id), body: String(r.body), body_html: String(r.body_html), author: String(r.author), created_at: Number(r.created_at) })),
    files: (files.rows ?? []).map(r => ({ id: String(r.id), name: String(r.name), type: String(r.type), size: Number(r.size) })),
  }
}
