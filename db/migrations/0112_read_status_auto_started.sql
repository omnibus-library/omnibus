-- Marks a status row that `progress::upsert_progress_tx` created when a position started the
-- book, as opposed to one a reader or device chose. An automatic `reading` carries the
-- position's time, so an explicit status dated earlier (a device finishing offline) would
-- otherwise lose to it. Every explicit write clears the mark; rows that exist today stay 0.
ALTER TABLE book_read_status ADD COLUMN auto_started INTEGER NOT NULL DEFAULT 0;
