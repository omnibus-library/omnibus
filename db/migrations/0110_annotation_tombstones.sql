-- One row per deleted annotation that carried a client id, so a KOReader device
-- listing changes since its cursor learns what went away. Annotations are hard-
-- deleted, and the Kobo channel needs no record because its GET serves the full
-- set. Never pruned: a row is two short strings and an integer.
CREATE TABLE annotation_tombstones (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_uuid  TEXT    NOT NULL,
    client_id  TEXT    NOT NULL,
    deleted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, client_id)
);
CREATE INDEX idx_annotation_tombstones_book
    ON annotation_tombstones(user_id, book_uuid, deleted_at);
