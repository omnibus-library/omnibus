-- Whether a non-admin may request a book the library lacks. Off by default, so
-- every existing reader keeps their current access; admins always may, so they
-- are backfilled to match `can_upload`'s "admin implies it" convention.
ALTER TABLE users ADD COLUMN can_request INTEGER NOT NULL DEFAULT 0;
UPDATE users SET can_request = 1 WHERE is_admin = 1;
