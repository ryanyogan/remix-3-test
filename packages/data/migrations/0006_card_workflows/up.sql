create table card_details (
  item_id text primary key not null references board_items(id) on delete cascade,
  description text not null default '',
  tags text not null default '[]' check(json_valid(tags)),
  pinned integer not null default 0 check(pinned in (0, 1)),
  priority text not null default 'normal' check(priority in ('normal', 'high', 'urgent')),
  snoozed_until integer not null default 0,
  updated_at integer not null
);
create table card_steps (
  id text primary key not null,
  item_id text not null references board_items(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 300),
  completed integer not null default 0 check(completed in (0, 1)),
  created_at integer not null
);
create index card_steps_item_idx on card_steps(item_id, created_at, id);
create table card_comments (
  id text primary key not null,
  item_id text not null references board_items(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 10000),
  created_at integer not null
);
create index card_comments_item_idx on card_comments(item_id, created_at, id);
create table api_tokens (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  token_hash text unique not null,
  created_at integer not null
);
create index api_tokens_user_idx on api_tokens(user_id, created_at);
create index board_items_column_position_idx on board_items(column_id, position);
