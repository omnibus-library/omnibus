-- The crengine XPointer a KOReader device last wrote, kept verbatim so another
-- KOReader can resume on the exact spot even when the server cannot map it to a
-- CFI. Every other position write binds NULL, so a newer position from the web,
-- iOS or a Kobo clears it; nothing else reads it.
ALTER TABLE reading_progress ADD COLUMN koreader_xpointer TEXT;
