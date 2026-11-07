-- A download is found in the client by its BitTorrent info hash, not by a tag Omnibus
-- attached, so `client_tag` and `remove_tag` become `client_hash` and `remove_hash`.
-- `client_adopted` is 1 when the client already held the torrent, which Omnibus then never
-- deletes. `legacy_tag` is a tag from before: the poller asks the client once which
-- download carries it, stores that download's hash and clears the tag.
ALTER TABLE book_requests RENAME COLUMN client_tag TO client_hash;
ALTER TABLE book_requests RENAME COLUMN remove_tag TO remove_hash;
ALTER TABLE book_requests ADD COLUMN client_adopted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_requests ADD COLUMN legacy_tag TEXT;

-- The source's page for a found version, as Prowlarr's `infoUrl` names it. Null for versions
-- found before it, and where the source gave none or an address that is not a web page.
ALTER TABLE book_request_results ADD COLUMN info_url TEXT;

UPDATE book_requests SET legacy_tag = client_hash, client_hash = NULL WHERE client_hash IS NOT NULL;
-- A request still downloading waits to be handed over again, which finds its download by the
-- tag first; one whose download is complete stays on its way for the import.
UPDATE book_requests
   SET state = 'chosen', progress = NULL, moved_at = NULL, expected_done_at = NULL
 WHERE state = 'on_its_way' AND legacy_tag IS NOT NULL AND (progress IS NULL OR progress < 1);
-- A removal still pending is dropped: its tag cannot be read as a hash, and that torrent stays in the client.
UPDATE book_requests SET remove_hash = NULL, remove_since = NULL;

-- Until now an empty category meant `omnibus`; an install that has a client set up keeps it.
INSERT OR REPLACE INTO settings (key, value)
SELECT 'download_client_category', 'omnibus'
 WHERE COALESCE((SELECT TRIM(value) FROM settings WHERE key = 'download_client_category'), '') = ''
   AND COALESCE((SELECT TRIM(value) FROM settings WHERE key = 'download_client_url'), '') <> '';

-- Asking for a book and picking its version become two permissions; whoever could request keeps both.
ALTER TABLE users RENAME COLUMN can_request TO can_start_requests;
ALTER TABLE users ADD COLUMN can_choose_request_versions INTEGER NOT NULL DEFAULT 0;
UPDATE users SET can_start_requests = 1 WHERE is_admin = 1;
UPDATE users SET can_choose_request_versions = can_start_requests;
