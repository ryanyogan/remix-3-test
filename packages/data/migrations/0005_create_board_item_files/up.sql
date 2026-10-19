-- Files attached to cards. The bytes live in file storage under the row id; this table holds
-- the metadata and the ownership used to authorize reads.
create table board_item_files (
  id text primary key not null,
  board_id text not null references boards(id) on delete cascade,
  item_id text not null references board_items(id) on delete cascade,
  name text not null check (length(name) between 1 and 255),
  type text not null,
  size integer not null check (size between 1 and 10485760),
  created_at integer not null
);

create index board_item_files_item_id_idx on board_item_files (item_id, created_at);
create index board_item_files_board_id_idx on board_item_files (board_id);
