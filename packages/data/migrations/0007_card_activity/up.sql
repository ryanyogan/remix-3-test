create table card_activity (
  id text primary key not null,
  item_id text not null references board_items(id) on delete cascade,
  kind text not null check(kind in ('updated', 'moved', 'done')),
  detail text not null default '',
  created_at integer not null
);
create index card_activity_item_time_idx on card_activity(item_id, created_at, id);
