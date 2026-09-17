-- Diacritic-folded copy of `authors.name` used as the match key for author
-- search. Nullable on purpose: a row that predates the boot backfill falls
-- back to matching the raw name rather than becoming invisible.
ALTER TABLE authors ADD COLUMN name_norm TEXT COLLATE NOCASE;
