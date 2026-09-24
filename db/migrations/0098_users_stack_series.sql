-- Per-user landing grid preference: fold each series into one tile. Off by
-- default, so existing accounts keep one tile per book.
ALTER TABLE users ADD COLUMN stack_series INTEGER NOT NULL DEFAULT 0;
