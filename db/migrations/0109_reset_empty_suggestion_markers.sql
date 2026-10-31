-- Forget every 'empty' suggestions marker so those books are looked up again.
--
-- An 'empty' marker recorded "Hardcover matched nothing" under the exact-title
-- matcher, which missed any title the library spells differently. Matching now
-- falls back to Hardcover's fuzzy search, so the old verdicts are stale.
-- 'empty' markers never own rows in book_suggestions (replace_suggestions
-- writes none for them), and the next view re-resolves a book with no marker.

DELETE FROM book_suggestion_state WHERE state = 'empty';
