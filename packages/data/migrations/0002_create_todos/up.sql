create table todos (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text not null default '',
  priority integer not null default 2 check (priority between 1 and 3),
  completed integer not null default 0 check (completed in (0, 1)),
  created_at integer not null
);

create index todos_user_id_idx on todos (user_id, created_at);
