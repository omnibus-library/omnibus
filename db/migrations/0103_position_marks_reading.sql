-- A saved position now starts its book: `progress::upsert_progress_tx` gives a
-- book with no read status `reading`. This gives the same status to every
-- position stored before that, so "no status" means untouched everywhere: the
-- book page and smart shelves read a missing row as unread, while the authors
-- page and the Continue rail read a position without one as reading.
--
-- Stamped, like the live path, with the reader's latest position time rather
-- than now: Kobo sync-out, "recently interacted" and a merge's choice between
-- editions all read the status time, and none of these books was started
-- today. Books no `books` row carries are skipped.
--
-- Being dated in the past, these statuses are no newer than the `synced_at` of
-- a Kobo already holding the book, so `sync_delta` would never send them. Zero
-- those watermarks first, while the books still have no status: each device
-- then re-announces each book once, and `record_synced` restores the mark.
UPDATE kobo_books_sync
   SET synced_at = 0
 WHERE EXISTS (SELECT 1
                 FROM kobo_devices d
                 JOIN reading_progress rp
                   ON rp.user_id = d.user_id AND rp.book_uuid = kobo_books_sync.book_uuid
                WHERE d.id = kobo_books_sync.device_id
                  AND NOT EXISTS (SELECT 1 FROM book_read_status rs
                                   WHERE rs.user_id = rp.user_id
                                     AND rs.book_uuid = rp.book_uuid));

INSERT INTO book_read_status (user_id, book_uuid, status, updated_at)
SELECT rp.user_id, rp.book_uuid, 'reading',
       MAX(COALESCE(rp.client_updated_at, rp.updated_at))
  FROM reading_progress rp
 WHERE EXISTS (SELECT 1 FROM books b WHERE b.uuid = rp.book_uuid)
   AND NOT EXISTS (SELECT 1 FROM book_read_status rs
                    WHERE rs.user_id = rp.user_id AND rs.book_uuid = rp.book_uuid)
 GROUP BY rp.user_id, rp.book_uuid;
