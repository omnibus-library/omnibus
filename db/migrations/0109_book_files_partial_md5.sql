-- KOReader's partial MD5 of an original ebook file: the `document` a KOReader
-- device sends to name a book over its progress sync. NULL = not yet hashed;
-- the post-scan backfill fills it, and a changed file's row is recreated NULL.
ALTER TABLE book_files ADD COLUMN partial_md5 TEXT;
CREATE INDEX idx_book_files_partial_md5 ON book_files(partial_md5);
