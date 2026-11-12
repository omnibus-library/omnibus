-- `kobo_books_sync.synced_at` now holds the `state_updated_at` of the state last delivered, not
-- the wall-clock time of the sync, and a state shares its watermark's second only while a later
-- save in that second can still be announced. Existing rows hold the old clock time, so a state
-- saved in the second of a sync (never announced, #2884) still equals its watermark and stays
-- unannounced. Shift every state watermark back a second: only a book whose state equals the
-- old watermark is announced again, once, as a state change. `last_modified_seen` and `resend`
-- are untouched, so nothing is downloaded again. A 0 means "no state delivered", so it stays.
UPDATE kobo_books_sync
   SET synced_at = synced_at - 1
 WHERE synced_at > 0;
