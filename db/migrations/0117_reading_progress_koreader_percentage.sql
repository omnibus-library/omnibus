-- The exact fraction a KOReader sent through kosync, beside its XPointer. Stock KOReader
-- takes an equal percentage as already in sync, so a pull must hand back this rather than
-- the floored whole percent. Every other position write binds NULL, clearing it with the
-- XPointer; nothing but kosync reads it.
ALTER TABLE reading_progress ADD COLUMN koreader_percentage REAL;
