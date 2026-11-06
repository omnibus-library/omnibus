-- How each found version is fetched, as Prowlarr names it, so a version with no seeders can
-- say it comes over Usenet. Null for versions found before this column, and for a protocol
-- Prowlarr reports as unknown.
ALTER TABLE book_request_results ADD COLUMN protocol TEXT CHECK (protocol IN ('torrent', 'usenet'));
