-- The download half of a book request. `client_tag` names the live job in the download
-- client (one tag per version added); `cancel_at` is when a cancel stops being undoable,
-- `prior_state` what Undo restores, and `moved_at` when the download last gained bytes. A
-- job to take out of the client moves to `remove_tag`; `remove_since` is when, and goes NULL
-- once the client has shown the job, which is how a job still being fetched is told from one
-- that never came. On a version, `tried` marks one that was picked and given up, which the
-- page still shows, greyed.
--
-- 0113 shipped before these columns did, so it is frozen (rule 06) and the wider `state`
-- CHECK means a rebuild: the create/copy/drop/rename shape of 0027. `book_request_results`
-- cascades from `book_requests`, and the implicit DELETE of the parent's DROP would take
-- every version with it (0038 spells out why), so the versions are rebuilt too, against the
-- new parent, and the old child goes before the old parent. The renames then point the
-- child's foreign key at the parent's final name.
CREATE TABLE book_requests_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    book_uuid        TEXT    NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('ebook', 'audiobook')),
    state            TEXT    NOT NULL CHECK (state IN ('looking', 'choose', 'chosen', 'on_its_way', 'stuck', 'cancelled')),
    stuck_reason     TEXT,
    stuck_detail     TEXT,
    chosen_result_id INTEGER,
    client_tag       TEXT,
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
     client_tag, progress, created_at, updated_at)
SELECT id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, chosen_result_id,
       client_tag, progress, created_at, updated_at
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
     best_match, rejected)
SELECT id, request_id, guid, title, size_bytes, format, seeders, indexer, download_url, score,
       best_match, rejected
  FROM book_request_results;

DROP TABLE book_request_results;
DROP TABLE book_requests;
ALTER TABLE book_requests_new RENAME TO book_requests;
ALTER TABLE book_request_results_new RENAME TO book_request_results;
CREATE INDEX idx_book_requests_book ON book_requests(book_uuid);
CREATE INDEX idx_book_requests_user ON book_requests(user_id, state);
CREATE INDEX idx_book_request_results_request ON book_request_results(request_id);
