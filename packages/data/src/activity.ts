import { sql, type Database } from 'remix/data-table'
import type { ActivityFilters, ActivityPage, ActivityEvent, NavigationData } from '@trellix/contracts'

export async function loadNavigation(db: Database, userId: string): Promise<NavigationData> {
  let [boards, tags] = await Promise.all([
    db.exec(sql`select id, name, color from boards where user_id = ${userId} order by created_at desc, id`),
    db.exec(sql`select distinct j.value as tag from boards b
      join board_items i on i.board_id = b.id join card_details d on d.item_id = i.id, json_each(d.tags) j
      where b.user_id = ${userId} order by j.value`),
  ])
  return {
    boards: (boards.rows ?? []).map(row => ({ id: String(row.id), name: String(row.name), color: String(row.color) })),
    tags: (tags.rows ?? []).map(row => String(row.tag)),
  }
}

// Read before starting a write batch: D1 cannot read its queued writes.
export async function movementKind(db: Database, boardId: string, columnId: string): Promise<'done' | 'moved'> {
  let result = await db.exec(sql`select id from board_columns where board_id = ${boardId} order by position desc, id desc limit 2`)
  return result.rows?.length === 2 && result.rows[0].id === columnId ? 'done' : 'moved'
}

export async function recordActivity(db: Database, itemId: string, kind: 'updated' | 'moved' | 'done', detail = '') {
  await db.exec(sql`insert into card_activity(id, item_id, kind, detail, created_at)
    values (${crypto.randomUUID()}, ${itemId}, ${kind}, ${detail}, ${Date.now()})`)
}

// Creation and comment timestamps already exist. Do not invent historical completion dates.
// Updates and moves are recorded atomically with their mutations from migration 0007 onward.
export async function loadActivity(db: Database, userId: string, filters: ActivityFilters = {}): Promise<ActivityPage> {
  let result = await db.exec(sql`with visible as (
    select i.id, i.title, i.created_at, b.id as board_id, b.name as board_name, b.color,
      b.user_id, u.name as actor_name
    from boards b join board_items i on i.board_id = b.id join users u on u.id = b.user_id
    left join card_details d on d.item_id = i.id
    where b.user_id = ${userId} and (${filters.board ?? ''} = '' or b.id = ${filters.board ?? ''})
      and (${filters.view ?? ''} != 'pinned' or d.pinned = 1)
      and (${filters.view ?? ''} != 'notifications' or not exists (
        select 1 from board_watches w where w.board_id = b.id and (w.watching = 0 or i.created_at < w.since)
      ))
      and (${filters.tag ?? ''} = '' or exists (select 1 from json_each(coalesce(d.tags, '[]')) where value = ${filters.tag ?? ''}))
  ), events as (
    select 'a:' || v.id as event_id, v.*, 'added' as kind, '' as detail, v.user_id as actor_id, v.created_at as at from visible v
    union all
    select 'e:' || e.id, v.*, e.kind, e.detail, v.user_id, e.created_at from visible v join card_activity e on e.item_id = v.id
    union all
    select 'c:' || c.id, v.id, v.title, v.created_at, v.board_id, v.board_name, v.color, v.user_id, u.name,
      'commented', c.body, c.user_id, c.created_at from visible v join card_comments c on c.item_id = v.id join users u on u.id = c.user_id
  ) select * from events where
    (${filters.view ?? ''} != 'added' or kind = 'added')
    and (${filters.view ?? ''} != 'notifications' or kind = 'added')
    and (${filters.person ?? ''} = '' or actor_id = ${filters.person ?? ''})
    and (at < ${filters.before ?? Number.MAX_SAFE_INTEGER} or (at = ${filters.before ?? Number.MAX_SAFE_INTEGER} and event_id < ${filters.beforeId ?? ''}))
    order by at desc, event_id desc limit 101`)
  let rows = result.rows ?? []
  let events = rows.slice(0, 100).map(row => ({
    id: String(row.event_id), cardId: String(row.id), title: String(row.title),
    boardId: String(row.board_id), boardName: String(row.board_name), color: String(row.color),
    kind: String(row.kind) as ActivityEvent['kind'], detail: String(row.detail),
    actorId: String(row.actor_id), actorName: String(row.actor_name), at: Number(row.at),
  }))
  let last = events.at(-1)
  return { events, next: rows.length > 100 && last ? { before: last.at, beforeId: last.id } : null }
}

// Keep one reader-local day in each streamed region. The underlying query remains
// bounded at 101 rows, including on busy days; its stable cursor continues those days.
export async function loadActivityDay(db: Database, userId: string, filters: ActivityFilters, timeZone: string): Promise<ActivityPage> {
  let page = await loadActivity(db, userId, filters)
  let format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  let first = page.events[0]
  if (!first) return page
  let date = format.format(first.at)
  let end = page.events.findIndex(event => format.format(event.at) !== date)
  if (end < 0) return page
  let events = page.events.slice(0, end), last = events.at(-1)!
  return { events, next: { before: last.at, beforeId: last.id } }
}
