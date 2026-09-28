-- Per-user "share stats with household" preference; on by default, so existing readers arrive sharing.
ALTER TABLE users ADD COLUMN share_stats INTEGER NOT NULL DEFAULT 1;
