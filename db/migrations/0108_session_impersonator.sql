-- An admin can sign in as another account for a bounded time. The session
-- that results belongs to the target user and names the admin behind it, so
-- the server can show who is really signed in and return them on exit.
-- Deleting the admin ends the sessions they opened. No backfill: NULL is an
-- ordinary sign-in.
ALTER TABLE sessions ADD COLUMN impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
