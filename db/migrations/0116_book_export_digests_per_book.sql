-- A bake's digest names a book only while no other book baked to the same bytes. Key the
-- table on the pair so a second book's row is kept (and the lookup can refuse the digest)
-- instead of being dropped under the first book's.
CREATE TABLE book_export_digests_new (
    partial_md5 TEXT    NOT NULL,
    book_uuid   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (partial_md5, book_uuid)
);
INSERT INTO book_export_digests_new (partial_md5, book_uuid, created_at)
    SELECT partial_md5, book_uuid, created_at FROM book_export_digests;
DROP TABLE book_export_digests;
ALTER TABLE book_export_digests_new RENAME TO book_export_digests;
CREATE INDEX idx_book_export_digests_book_uuid ON book_export_digests(book_uuid);
