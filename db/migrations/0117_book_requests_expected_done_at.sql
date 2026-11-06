-- When the download client expects a request's download to finish, in Unix seconds; NULL
-- when it can't tell or nothing is downloading. Recorded by the download poller.
ALTER TABLE book_requests ADD COLUMN expected_done_at INTEGER;
