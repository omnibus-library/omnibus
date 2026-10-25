-- The `book_files` row a served file was made from: a book merged from two EPUB editions
-- serves either, and a KOReader position is only exact in the edition it was taken in.
-- Soft reference like `reading_progress.book_file_id` (a reindex may replace the row);
-- NULL for rows recorded before, which name no edition.
ALTER TABLE book_export_digests ADD COLUMN book_file_id INTEGER;
