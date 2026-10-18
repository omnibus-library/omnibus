-- A fresh sync marks the books it resends here instead of deleting their rows,
-- so a dropped response or a later page still owes the removal of any of them.
-- Separate from `last_modified_seen = -1` (0100), which resends metadata only.
ALTER TABLE kobo_books_sync ADD COLUMN resend INTEGER NOT NULL DEFAULT 0;
