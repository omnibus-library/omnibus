-- The per-reader rating grows into a review: one row per (reader, book) holding
-- optional half stars, public markdown text, private notes and a spoiler flag.
-- Making the stars optional means a table rebuild (SQLite can't drop NOT NULL),
-- so the table takes its new name here too.
--
-- `rated_at` moves only when the stars change, never on a text edit, so the
-- stats rating trend (keyed on it) doesn't pull an old rating into this month.
-- It is NULL exactly when the stars are. A row with no stars, text or notes is
-- deleted rather than kept, which the last CHECK enforces.
--
-- Still a soft `book_uuid` reference (no FK, no cascade), like 0031: a pruned
-- book detaches its reviews and the missing-files GC keeps any book one names.
CREATE TABLE reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_uuid  TEXT    NOT NULL,                      -- soft ref: no FK, no CASCADE
    half_stars INTEGER CHECK (half_stars BETWEEN 1 AND 10),
    body_md    TEXT,
    notes_md   TEXT,
    spoiler    INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
    rated_at   INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (user_id, book_uuid),
    CHECK ((half_stars IS NULL) = (rated_at IS NULL)),
    CHECK (half_stars IS NOT NULL OR body_md IS NOT NULL OR notes_md IS NOT NULL)
);

-- A rating carried only `updated_at`, which was when its stars were set.
INSERT INTO reviews (id, user_id, book_uuid, half_stars, rated_at, created_at, updated_at)
SELECT id, user_id, book_uuid, half_stars, updated_at, updated_at, updated_at
  FROM user_ratings;

DROP TABLE user_ratings;

-- Serves the missing-files GC's `NOT EXISTS (… WHERE book_uuid = ?)` probe and
-- the book page's per-book read, as `idx_user_ratings_book` did.
CREATE INDEX idx_reviews_book ON reviews(book_uuid);
