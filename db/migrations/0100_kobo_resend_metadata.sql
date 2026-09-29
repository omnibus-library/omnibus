-- Resend every synced book's metadata once, so devices pick up versioned
-- cover ids, every author, and the series. Metadata only: no file re-download.
UPDATE kobo_books_sync SET last_modified_seen = 0;
