-- A KOReader edit that moves a highlight's CFI leaves the Kobo anchor it was derived from in
-- place and flags it, so the Kobo keeps its copy until the downsync derives the new anchor.
-- NULLing the anchor instead dropped the row from the served set, which a Kobo reads as a delete.
ALTER TABLE annotations ADD COLUMN kobo_location_stale INTEGER NOT NULL DEFAULT 0;
