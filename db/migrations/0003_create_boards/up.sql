create table boards (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#cbd5e1',
  created_at integer not null
);

create index boards_user_id_idx on boards (user_id, created_at);

create table board_columns (
  id text primary key not null,
  board_id text not null references boards(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position real not null,
  created_at integer not null
);

create index board_columns_board_id_idx on board_columns (board_id, position);

-- Items order within a column by a float position: a card dropped between 1.0 and 2.0
-- lands at 1.5, so a move only ever rewrites the moved card.
create table board_items (
  id text primary key not null,
  board_id text not null references boards(id) on delete cascade,
  column_id text not null references board_columns(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  position real not null,
  created_at integer not null
);

create index board_items_board_id_idx on board_items (board_id, column_id, position);

-- Carry existing todos over: one "Todos" board per user, open todos in "To do",
-- finished ones in "Done". The todos table itself is left in place.
insert into boards (id, user_id, name, color, created_at)
select lower(hex(randomblob(16))), user_id, 'Todos', '#cbd5e1', min(created_at)
from todos
group by user_id;

insert into board_columns (id, board_id, name, position, created_at)
select lower(hex(randomblob(16))), boards.id, stage.name, stage.position, boards.created_at
from boards
cross join (
  select 'To do' as name, 1 as position
  union all select 'In progress', 2
  union all select 'Done', 3
) as stage;

insert into board_items (id, board_id, column_id, title, position, created_at)
select
  todos.id,
  boards.id,
  board_columns.id,
  todos.title,
  row_number() over (partition by board_columns.id order by todos.priority, todos.created_at),
  todos.created_at
from todos
join boards on boards.user_id = todos.user_id
join board_columns
  on board_columns.board_id = boards.id
  and board_columns.name = case when todos.completed then 'Done' else 'To do' end;
