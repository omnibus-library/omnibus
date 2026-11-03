-- A reader's request for one digital format of a book, and the versions the search found.
-- `book_uuid` is the canonical `books.uuid`, soft-referenced like the other user data: a
-- request outlives its wishlist entry, and a merge retargets it. Ids never repeat, so a
-- stale link or a stale Choose click cannot land on a later row. `client_tag` names the live
-- job in the download client (one tag per version added); `cancel_at` is when a cancel stops
-- being undoable, `prior_state` what Undo restores, and `moved_at` when the download last gained
-- bytes. A job to take out of the client moves to `remove_tag`; `remove_since` is when, and goes
-- NULL once the client has shown the job, which is how a job still being fetched is told from one
-- that never came. `import_key` is the library-relative key of the file a finished download was
-- placed as, so a retried import resumes at the scan instead of filing a second copy.
CREATE TABLE book_requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    book_uuid        TEXT    NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('ebook', 'audiobook')),
    state            TEXT    NOT NULL CHECK (state IN ('looking', 'choose', 'chosen', 'on_its_way', 'ready', 'stuck', 'cancelled')),
    stuck_reason     TEXT,
    stuck_detail     TEXT,
    chosen_result_id INTEGER,
    client_tag       TEXT,
    import_key       TEXT,
    remove_tag       TEXT,
    remove_since     INTEGER,
    progress         REAL,
    moved_at         INTEGER,
    cancel_at        INTEGER,
    cancelled_by     INTEGER,
    prior_state      TEXT,
    note             TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_book_requests_book ON book_requests(book_uuid);
CREATE INDEX idx_book_requests_user ON book_requests(user_id, state);

-- `download_url` stays on the server: it can carry the indexer's key and no response shows it.
-- `rejected` keeps a version off the Choose list; `tried` marks one that was picked and given up,
-- which the page still shows, greyed.
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
    rejected     INTEGER NOT NULL DEFAULT 0,
    tried        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_book_request_results_request ON book_request_results(request_id);
