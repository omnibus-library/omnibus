-- Drop the extra `books_series_link` rows an old series override left behind.
--
-- Overriding a book's series linked the new series without unlinking the old
-- one, and clearing the override never unlinked it either, so a book could hold
-- its scanned series plus every series it was ever overridden to. A link is
-- kept when it is the scanned one (the series `books.series_sort` names, or the
-- canonical a cleanup merge folded that name into) or the series the book's
-- current override names. A book with no `series_sort`, or none of whose links
-- match it, is left alone: nothing says which link the scan wrote.

DELETE FROM books_series_link
 WHERE EXISTS (
        SELECT 1
          FROM books b
         WHERE b.id = books_series_link.book
           AND b.series_sort IS NOT NULL
           -- the book has a scanned link, so removing an extra one orphans nothing
           AND EXISTS (
                SELECT 1
                  FROM books_series_link kept
                  JOIN series ks ON ks.id = kept.series
                 WHERE kept.book = b.id
                   AND (ks.name = b.series_sort COLLATE NOCASE
                        OR ks.id = (SELECT ea.canonical_id FROM entity_aliases ea
                                     WHERE ea.kind = 'series'
                                       AND ea.alias_name = b.series_sort COLLATE NOCASE)))
           -- this link is not the scanned one...
           AND NOT EXISTS (
                SELECT 1
                  FROM series s
                 WHERE s.id = books_series_link.series
                   AND (s.name = b.series_sort COLLATE NOCASE
                        OR s.id = (SELECT ea.canonical_id FROM entity_aliases ea
                                    WHERE ea.kind = 'series'
                                      AND ea.alias_name = b.series_sort COLLATE NOCASE)))
           -- ...nor the series the current override names
           AND NOT EXISTS (
                SELECT 1
                  FROM metadata_overrides mo
                  JOIN series os
                    ON os.name = json_extract(mo.overrides, '$.series') COLLATE NOCASE
                 WHERE mo.book_uuid = b.uuid
                   AND json_valid(mo.overrides)
                   AND os.id = books_series_link.series)
 );
