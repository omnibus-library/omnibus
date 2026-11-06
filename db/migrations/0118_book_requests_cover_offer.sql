-- The cover a finished download brought. `cover_candidate` is the uuid the download was
-- scanned in as before it was merged away; its cover file is on offer until the reader
-- takes or keeps it. `offers_cover` is 0 for a request whose book was made just for it,
-- whose import keeps the merge's own cover.
ALTER TABLE book_requests ADD COLUMN offers_cover INTEGER NOT NULL DEFAULT 1;
ALTER TABLE book_requests ADD COLUMN cover_candidate TEXT;
