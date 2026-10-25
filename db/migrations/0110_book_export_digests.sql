-- Every override-baked EPUB a download has served, named by its KOReader partial
-- MD5. A device that downloaded a bake names the book by that digest, not the
-- original file's, so each bake stays resolvable after the next override edit.
-- `book_uuid` is a soft reference (no FK), settled by merge and purge.
CREATE TABLE book_export_digests (
    partial_md5 TEXT    PRIMARY KEY,
    book_uuid   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_book_export_digests_book_uuid ON book_export_digests(book_uuid);
