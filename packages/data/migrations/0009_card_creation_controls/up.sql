alter table card_details add column assignee_id text references users(id) on delete set null;
alter table card_details add column cover_file_id text references board_item_files(id) on delete set null;
