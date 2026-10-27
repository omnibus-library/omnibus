-- KOReader sync: device kinds, positions, annotation deletes and the digests a
-- KOReader names a book by.

-- Which kind of reader a registered device is: a Kobo, a KOReader with the plugin, or a
-- KOReader syncing through its built-in Progress sync. Existing rows are Kobos; a token only
-- authenticates the routes of its own kind. `last_sync_*` is what the plugin last reported
-- about a sync: when, and the failure (NULL = it succeeded).
ALTER TABLE kobo_devices
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'kobo' CHECK (kind IN ('kobo', 'koreader', 'kosync'));
ALTER TABLE kobo_devices ADD COLUMN last_sync_at INTEGER;
ALTER TABLE kobo_devices ADD COLUMN last_sync_error TEXT;

-- SHA-256 of the MD5 a KOReader sends as its kosync password. NULL = kosync is off for
-- this reader. The generated password is shown once and never stored.
ALTER TABLE users ADD COLUMN kosync_key_hash BLOB;

-- The crengine XPointer and, through kosync, the exact fraction a KOReader last wrote, kept
-- verbatim so another KOReader resumes on the exact spot even when the server cannot map it
-- to a CFI (stock KOReader takes an equal percentage as already in sync). Every other
-- position write binds NULL, so a newer position from the web, iOS or a Kobo clears both.
ALTER TABLE reading_progress ADD COLUMN koreader_xpointer TEXT;
ALTER TABLE reading_progress ADD COLUMN koreader_percentage REAL;

-- Marks a status row that `progress::upsert_progress_tx` created when a position started the
-- book, as opposed to one a reader or device chose. An automatic `reading` carries the
-- position's time, so an explicit status dated earlier (a device finishing offline) would
-- otherwise lose to it. Every explicit write clears the mark.
ALTER TABLE book_read_status ADD COLUMN auto_started INTEGER NOT NULL DEFAULT 0;

-- A KOReader edit that moves a highlight's CFI leaves the Kobo anchor it was derived from in
-- place and flags it, so the Kobo keeps its copy until the downsync derives the new anchor.
-- NULLing the anchor instead would drop the row from the served set, which a Kobo reads as a delete.
ALTER TABLE annotations ADD COLUMN kobo_location_stale INTEGER NOT NULL DEFAULT 0;

-- One row per deleted annotation that carried a client id, so a KOReader device
-- listing changes since its cursor learns what went away. Annotations are hard-
-- deleted, and the Kobo channel needs no record because its GET serves the full
-- set. Never pruned: a row is two short strings and an integer.
CREATE TABLE annotation_tombstones (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_uuid  TEXT    NOT NULL,
    client_id  TEXT    NOT NULL,
    deleted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, client_id)
);
CREATE INDEX idx_annotation_tombstones_book
    ON annotation_tombstones(user_id, book_uuid, deleted_at);

-- KOReader's partial MD5 of an original ebook file: the `document` a KOReader
-- device sends to name a book over its progress sync. NULL = not yet hashed;
-- the post-scan backfill fills it, and a changed file's row is recreated NULL.
ALTER TABLE book_files ADD COLUMN partial_md5 TEXT;
CREATE INDEX idx_book_files_partial_md5 ON book_files(partial_md5);

-- Every override-baked EPUB a download has served, named by its KOReader partial MD5. A
-- device that downloaded a bake names the book by that digest, not the original file's, so
-- each bake stays resolvable after the next override edit. Keyed on the pair because a
-- digest names a book only while no other book baked to the same bytes: a second book's row
-- is kept so the lookup can refuse the digest. `book_uuid` is a soft reference (no FK),
-- settled by merge and purge. `book_file_id` is the edition the file was made from (a book
-- merged from two EPUB editions serves either, and a KOReader position is only exact in its
-- own), a soft reference like `reading_progress.book_file_id`.
CREATE TABLE book_export_digests (
    partial_md5  TEXT    NOT NULL,
    book_uuid    TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    book_file_id INTEGER,
    PRIMARY KEY (partial_md5, book_uuid)
);
CREATE INDEX idx_book_export_digests_book_uuid ON book_export_digests(book_uuid);
