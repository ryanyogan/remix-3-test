create table editor_uploads (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  type text not null,
  size integer not null check(size between 1 and 10485760),
  created_at integer not null
);
create index editor_uploads_owner_idx on editor_uploads(user_id, created_at);
