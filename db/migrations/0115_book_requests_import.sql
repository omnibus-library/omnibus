-- The import half of a book request. `import_key` is the library-relative key of the file a
-- finished download was placed as, so a retried import resumes at the scan instead of filing
-- a second copy; `ready` is the state a request reaches once that file is on the shelf.
--
-- 0114 may already be applied, so this is the same rebuild for the same reason: a wider
-- `state` CHECK, and a child that cascades from the parent, so both tables are recreated,
-- the old child goes before the old parent, and the renames point the child's foreign key
-- at the parent's final name (0038 spells out the cascade; 0027 the shape).
CREATE TABLE book_requests_new (
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
INSERT INTO book_requests_new
    (id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, chosen_result_id,
     client_tag, remove_tag, remove_since, progress, moved_at, cancel_at, cancelled_by,
     prior_state, note, created_at, updated_at)
SELECT id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, chosen_result_id,
       client_tag, remove_tag, remove_since, progress, moved_at, cancel_at, cancelled_by,
       prior_state, note, created_at, updated_at
  FROM book_requests;

CREATE TABLE book_request_results_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id   INTEGER NOT NULL REFERENCES book_requests_new(id) ON DELETE CASCADE,
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
INSERT INTO book_request_results_new
    (id, request_id, guid, title, size_bytes, format, seeders, indexer, download_url, score,
     best_match, rejected, tried)
SELECT id, request_id, guid, title, size_bytes, format, seeders, indexer, download_url, score,
       best_match, rejected, tried
  FROM book_request_results;

DROP TABLE book_request_results;
DROP TABLE book_requests;
ALTER TABLE book_requests_new RENAME TO book_requests;
ALTER TABLE book_request_results_new RENAME TO book_request_results;
CREATE INDEX idx_book_requests_book ON book_requests(book_uuid);
CREATE INDEX idx_book_requests_user ON book_requests(user_id, state);
CREATE INDEX idx_book_request_results_request ON book_request_results(request_id);
