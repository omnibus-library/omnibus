-- Which kind of reader a registered device is. Existing rows are Kobos; a
-- token only authenticates the routes of its own kind.
ALTER TABLE kobo_devices
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'kobo' CHECK (kind IN ('kobo', 'koreader'));
