create table column_colors (
  column_id text primary key not null references board_columns(id) on delete cascade,
  color text not null check (color in ('blue', 'gray', 'tan', 'yellow', 'lime', 'aqua', 'violet', 'purple', 'pink'))
);
