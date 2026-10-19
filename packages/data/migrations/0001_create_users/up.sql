create table users (
  id text primary key not null,
  email text not null unique check (length(trim(email)) > 0),
  name text not null check (length(trim(name)) > 0),
  password_hash text not null,
  created_at integer not null
);
