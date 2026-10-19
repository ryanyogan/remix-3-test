create table board_watches (
  board_id text primary key not null references boards(id) on delete cascade,
  watching integer not null default 1 check (watching in (0, 1)),
  since integer not null
);
