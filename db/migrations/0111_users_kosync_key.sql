-- SHA-256 of the MD5 a KOReader sends as its kosync password. NULL = kosync is off for
-- this reader. The generated password is shown once and never stored.
ALTER TABLE users ADD COLUMN kosync_key_hash BLOB;
