-- A reader's choice to keep a series off their home page's series in progress.
-- Per reader, so it follows the user; deleting the series or the account drops
-- it. No book column: a hide names the series, never a book.
CREATE TABLE series_hides (
    user_id   INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    hidden_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    PRIMARY KEY (user_id, series_id)
);
