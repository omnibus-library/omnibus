-- A fourth kind of device: a KOReader syncing through its built-in Progress sync, with no plugin.
-- SQLite cannot widen a CHECK in place, so the table is rebuilt. Dropping it cascades into the
-- two tables that reference it (a migration runs in a transaction, where the foreign_keys
-- pragma is a no-op), so their rows are parked in temp tables and put back.
CREATE TEMP TABLE kobo_books_sync_keep AS SELECT * FROM kobo_books_sync;
CREATE TEMP TABLE kobo_annotations_sync_keep AS SELECT * FROM kobo_annotations_sync;

CREATE TABLE kobo_devices_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    kobo_device_id  TEXT,
    sync_cursor     TEXT,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_seen_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    kind            TEXT    NOT NULL DEFAULT 'kobo' CHECK (kind IN ('kobo', 'koreader', 'kosync')),
    last_sync_at    INTEGER,
    last_sync_error TEXT
);

INSERT INTO kobo_devices_new
    (id, user_id, token, name, kobo_device_id, sync_cursor, created_at, last_seen_at,
     kind, last_sync_at, last_sync_error)
SELECT id, user_id, token, name, kobo_device_id, sync_cursor, created_at, last_seen_at,
       kind, last_sync_at, last_sync_error
FROM kobo_devices;

DROP TABLE kobo_devices;
ALTER TABLE kobo_devices_new RENAME TO kobo_devices;

CREATE INDEX idx_kobo_devices_user ON kobo_devices(user_id);
CREATE UNIQUE INDEX kobo_devices_hardware_id_idx
    ON kobo_devices(kobo_device_id) WHERE kobo_device_id IS NOT NULL;

INSERT INTO kobo_books_sync SELECT * FROM kobo_books_sync_keep;
INSERT INTO kobo_annotations_sync SELECT * FROM kobo_annotations_sync_keep;
DROP TABLE kobo_books_sync_keep;
DROP TABLE kobo_annotations_sync_keep;
