-- What the KOReader plugin last reported about a sync: when, and the failure (NULL = it
-- succeeded). Existing rows have never reported.
ALTER TABLE kobo_devices ADD COLUMN last_sync_at INTEGER;
ALTER TABLE kobo_devices ADD COLUMN last_sync_error TEXT;
