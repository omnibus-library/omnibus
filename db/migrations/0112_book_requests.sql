-- A reader's request for one digital format of a book, and the versions the search found.
-- `book_uuid` is the canonical `books.uuid`, soft-referenced like the other user data: a
-- request outlives its wishlist entry, and a merge retargets it. Ids never repeat, so a
-- stale link or a stale Choose click cannot land on a later row.
CREATE TABLE book_requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    book_uuid        TEXT    NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('ebook', 'audiobook')),
    state            TEXT    NOT NULL CHECK (state IN ('looking', 'choose', 'chosen', 'stuck')),
    stuck_reason     TEXT,
    stuck_detail     TEXT,
    chosen_result_id INTEGER,
    client_tag       TEXT,
    progress         REAL,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_book_requests_book ON book_requests(book_uuid);
CREATE INDEX idx_book_requests_user ON book_requests(user_id, state);

-- `download_url` stays on the server: it can carry the indexer's key and no response shows it.
CREATE TABLE book_request_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id   INTEGER NOT NULL REFERENCES book_requests(id) ON DELETE CASCADE,
    guid         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    size_bytes   INTEGER,
    format       TEXT,
    seeders      INTEGER,
    indexer      TEXT,
    download_url TEXT    NOT NULL,
    score        REAL    NOT NULL,
    best_match   INTEGER NOT NULL DEFAULT 0,
    rejected     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_book_request_results_request ON book_request_results(request_id);
