import { sql, type Database } from 'remix/data-table'
import type { WorkspaceCard, WorkspaceData } from '@trellix/contracts'

// Bounded feeds and three previews per board, independent of a workspace's card count.
// Shared by server rendering and the Hono API; no internal HTTP round trip for HTML.
export async function loadWorkspace(db: Database, userId: string): Promise<WorkspaceData> {
  let [boards, cards, previews] = await Promise.all([
    db.exec(sql`select b.id, b.name, b.color, count(i.id) as total,
      coalesce(sum(case when i.column_id = (select id from board_columns where board_id = b.id order by position desc, id desc limit 1) then 1 else 0 end), 0) as done
      from boards b left join board_items i on i.board_id = b.id
      where b.user_id = ${userId} group by b.id order by b.created_at desc, b.id`),
    db.exec(sql`with cards as (
      select i.id, i.title, i.board_id, b.name as board_name, b.color, co.name as column_name,
        coalesce(d.tags, '[]') as tags, coalesce(d.pinned, 0) as pinned,
        coalesce(d.priority, 'normal') as priority, coalesce(d.snoozed_until, 0) as snoozed_until,
        max(i.created_at, coalesce(d.updated_at, 0), coalesce((select max(created_at) from card_comments where item_id = i.id), 0)) as updated_at,
        i.column_id = (select id from board_columns where board_id = b.id order by position desc, id desc limit 1) as done
      from boards b join board_items i on i.board_id = b.id
      join board_columns co on co.id = i.column_id left join card_details d on d.item_id = i.id
      where b.user_id = ${userId}
    ), ranked as (
      select *, row_number() over(order by updated_at desc, id desc) as recent_rank,
        row_number() over(partition by pinned order by updated_at desc, id desc) as pin_rank from cards
    ) select * from ranked where recent_rank <= 24 or (pinned = 1 and pin_rank <= 12)
      order by updated_at desc, id desc`),
    db.exec(sql`with previews as (
      select i.id, i.title, i.board_id, row_number() over(partition by b.id order by co.position, i.position, i.id) as rank
      from boards b join board_items i on i.board_id = b.id join board_columns co on co.id = i.column_id
      where b.user_id = ${userId}
    ) select * from previews where rank <= 3 order by rank`),
  ])
  let map = (row: Record<string, unknown>): WorkspaceCard => ({
    id: String(row.id), title: String(row.title), boardId: String(row.board_id), boardName: String(row.board_name),
    color: String(row.color), columnName: String(row.column_name), tags: JSON.parse(String(row.tags)),
    pinned: Boolean(row.pinned), priority: String(row.priority), snoozedUntil: Number(row.snoozed_until),
    updatedAt: Number(row.updated_at), done: Boolean(row.done),
  })
  let previewsByBoard = new Map<string, { id: string; title: string }[]>()
  for (let row of previews.rows ?? []) {
    let id = String(row.board_id)
    let group = previewsByBoard.get(id) ?? []
    group.push({ id: String(row.id), title: String(row.title) })
    previewsByBoard.set(id, group)
  }
  return {
    boards: (boards.rows ?? []).map(row => ({ id: String(row.id), name: String(row.name), color: String(row.color),
      total: Number(row.total), done: Number(row.done),
      previews: previewsByBoard.get(String(row.id)) ?? [],
    })),
    recent: (cards.rows ?? []).filter(row => Number(row.recent_rank) <= 24).map(map),
    pinned: (cards.rows ?? []).filter(row => Boolean(row.pinned) && Number(row.pin_rank) <= 12).map(map),
  }
}
