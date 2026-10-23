-- Admit 'failed' to `book_suggestion_state.state`.
--
-- A suggestions lookup that errors (a rejected Hardcover key, an outage) used
-- to leave its marker 'pending', so the book page showed a loading strip for as
-- long as the lookup kept failing. 'failed' is the terminal state the worker
-- now writes instead; it is retried after the pending debounce.
--
-- SQLite can't ALTER a CHECK in place, so this is a table rebuild (the
-- pattern migration 0085 follows). Nothing references the table, and its only
-- key is the primary key the new table repeats.

CREATE TABLE book_suggestion_state_new (
    book_uuid  TEXT PRIMARY KEY,
    state      TEXT    NOT NULL CHECK (state IN ('pending', 'resolved', 'empty', 'failed')),
    fetched_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
INSERT INTO book_suggestion_state_new (book_uuid, state, fetched_at)
    SELECT book_uuid, state, fetched_at FROM book_suggestion_state;

DROP TABLE book_suggestion_state;
ALTER TABLE book_suggestion_state_new RENAME TO book_suggestion_state;
