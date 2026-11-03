-- A reader's rule for books left out of their stats (a `ViewFilters` JSON blob; NULL = nothing left out).
ALTER TABLE users ADD COLUMN stats_exclusions TEXT;

-- The rule's matches, rebuilt from it at the start of each stats request so the stats queries test one indexed key.
CREATE TABLE stats_excluded_books (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_uuid TEXT    NOT NULL,
    PRIMARY KEY (user_id, book_uuid)
) WITHOUT ROWID;
