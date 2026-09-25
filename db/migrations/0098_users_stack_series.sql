-- Per-user landing grid preference: fold each series into one tile.
ALTER TABLE users ADD COLUMN stack_series INTEGER NOT NULL DEFAULT 0;
