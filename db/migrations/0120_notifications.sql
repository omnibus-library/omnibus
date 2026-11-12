-- Notification connections and their outbox. `kind` names the provider and `settings` holds
-- its JSON, secrets included; both are checked in Rust, so a later provider needs no table
-- rebuild. `events` is a JSON array of event names.
CREATE TABLE notification_connections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    settings   TEXT    NOT NULL,
    events     TEXT    NOT NULL DEFAULT '[]',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- One notification for one connection, queued in the transaction that caused it and sent by
-- the drain loop. `state` is `queued` until it is `delivered` or `failed`; `finished_at` is
-- set then. Times are Unix seconds.
CREATE TABLE notification_deliveries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   INTEGER NOT NULL REFERENCES notification_connections(id) ON DELETE CASCADE,
    event           TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    state           TEXT    NOT NULL CHECK (state IN ('queued', 'delivered', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_error      TEXT,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    finished_at     INTEGER
);
CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(state, next_attempt_at);
CREATE INDEX idx_notification_deliveries_connection
    ON notification_deliveries(connection_id, finished_at);
