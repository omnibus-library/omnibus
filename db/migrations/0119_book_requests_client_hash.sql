-- A download is found in the client by its BitTorrent info hash, not by a tag Omnibus
-- attached, so `client_tag` and `remove_tag` become `client_hash` and `remove_hash`.
-- `client_adopted` is 1 when the client already held the torrent, which Omnibus then never
-- deletes.
ALTER TABLE book_requests RENAME COLUMN client_tag TO client_hash;
ALTER TABLE book_requests RENAME COLUMN remove_tag TO remove_hash;
ALTER TABLE book_requests ADD COLUMN client_adopted INTEGER NOT NULL DEFAULT 0;

-- A tag is not a hash, so no download handed over before this can be found again. A request
-- still downloading goes back to waiting for its hand-off, which adopts the torrent if the
-- client has it; a removal still pending is dropped, leaving that torrent in the client.
UPDATE book_requests
   SET state = 'chosen', progress = NULL, moved_at = NULL, expected_done_at = NULL
 WHERE state = 'on_its_way' AND client_hash IS NOT NULL;
UPDATE book_requests SET client_hash = NULL, remove_hash = NULL, remove_since = NULL;
