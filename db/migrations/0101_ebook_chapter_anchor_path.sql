-- Where a TOC entry's fragment lands inside a spine item it shares with
-- another entry: the in-document CFI step path of the element it names
-- (`/4/2/6`), so a position can be placed between the two. NULL when the
-- entry has its spine item to itself, or the fragment names nothing.
ALTER TABLE ebook_chapters ADD COLUMN anchor_path TEXT;

-- EPUBs extracted before the column have NULLs exactly where it matters.
-- Dropping their structure hands them back to the post-scan backfill, which
-- re-extracts it whole; every other file keeps its rows untouched.
CREATE TEMP TABLE shared_spine_files AS
    SELECT DISTINCT c.book_file_id
    FROM ebook_chapters c
    JOIN book_files bf ON bf.id = c.book_file_id
    WHERE UPPER(bf.format) = 'EPUB'
    GROUP BY c.book_file_id, c.spine_index
    HAVING COUNT(*) > 1;
DELETE FROM epub_spine_stats WHERE book_file_id IN (SELECT book_file_id FROM shared_spine_files);
DELETE FROM ebook_chapters WHERE book_file_id IN (SELECT book_file_id FROM shared_spine_files);
DROP TABLE shared_spine_files;
