-- Bumped on sign out. Sessions carry the version they were issued with, so a copied or
-- replayed cookie stops working everywhere once its user signs out.
alter table users add column session_version integer not null default 0;
