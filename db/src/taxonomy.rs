//! Per-row resolve-or-insert helpers for the single-valued normalized
//! taxonomy tables (`series`, `publishers`, `languages`), plus the orphan
//! sweeps run wherever a book's last link can disappear. Kept module-private
//! at the crate root, exposed via `pub(crate)`. The multi-valued relations
//! (authors, tags, identifiers) are inserted in batches directly in `sync`.

use std::collections::HashMap;

use omnibus_shared::CleanupKind;
use sqlx::Transaction;

use crate::entity_alias::resolve_entity_aliases;

/// Taxonomy resolve-or-insert helpers. Each returns the row id for the given
/// (case-insensitive) name, inserting a row if one doesn't exist yet. The shape
/// is identical for every taxonomy table (`INSERT OR IGNORE`, then `SELECT id`);
/// a macro keeps the table/column compile-time string literals, so no SQL is
/// built at runtime from user input.
macro_rules! resolve_or_insert_simple {
    ($name:ident, $table:literal, $col:literal) => {
        pub(crate) async fn $name(
            tx: &mut Transaction<'_, sqlx::Sqlite>,
            value: &str,
        ) -> Result<i64, sqlx::Error> {
            sqlx::query(concat!(
                "INSERT OR IGNORE INTO ",
                $table,
                " (",
                $col,
                ") VALUES (?)",
            ))
            .bind(value)
            .execute(&mut **tx)
            .await?;
            sqlx::query_scalar(concat!("SELECT id FROM ", $table, " WHERE ", $col, " = ?",))
                .bind(value)
                .fetch_one(&mut **tx)
                .await
        }
    };
}

resolve_or_insert_simple!(resolve_or_insert_tag, "tags", "name");
resolve_or_insert_simple!(resolve_or_insert_publisher, "publishers", "name");
resolve_or_insert_simple!(resolve_or_insert_language, "languages", "code");

/// Resolve `value` to a `series.id`, consulting the reindex-resurrection guard
/// first: if `value` was absorbed into another series by a completed
/// library-cleanup merge, return the surviving canonical id rather than minting
/// a fresh row. Does its own single-name alias lookup, so it suits callers off
/// the hot path; the reindex loop uses [`resolve_or_insert_series_with_aliases`].
pub(crate) async fn resolve_or_insert_series(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    value: &str,
) -> Result<i64, sqlx::Error> {
    if let Some(canonical_id) = resolve_entity_aliases(tx, CleanupKind::Series, &[value])
        .await?
        .remove(value)
    {
        return Ok(canonical_id);
    }
    insert_or_select_series(tx, value).await
}

/// Batch-aware sibling of [`resolve_or_insert_series`] for the reindex write
/// loop: consults `aliases`, a lookup resolved once for the whole sync batch
/// (`sync::books::collect_entity_alias_maps`), instead of issuing its own
/// per-call `resolve_entity_aliases` query — the per-book fan-out
/// this avoids.
pub(crate) async fn resolve_or_insert_series_with_aliases(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    value: &str,
    aliases: &HashMap<String, i64>,
) -> Result<i64, sqlx::Error> {
    if let Some(canonical_id) = aliases.get(value) {
        return Ok(*canonical_id);
    }
    insert_or_select_series(tx, value).await
}

/// Shared `INSERT OR IGNORE` / `SELECT` tail for both series resolvers above.
async fn insert_or_select_series(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    value: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO series (name) VALUES (?)")
        .bind(value)
        .execute(&mut **tx)
        .await?;
    sqlx::query_scalar("SELECT id FROM series WHERE name = ?")
        .bind(value)
        .fetch_one(&mut **tx)
        .await
}

/// Delete taxonomy rows (`authors`, `series`, `publishers`, `languages`) no
/// longer referenced by any book, then reap orphaned tags and genres via
/// [`delete_orphan_tags`] and [`delete_orphan_genres`]. Run wherever the last
/// link to a row can disappear: the missing-files GC purge, the merge source
/// delete, the indexer's Changed bucket, and a direct override-row delete.
pub(crate) async fn delete_orphan_taxonomy(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<(), sqlx::Error> {
    for (table, link, col) in [
        ("series", "books_series_link", "series"),
        ("publishers", "books_publishers_link", "publisher"),
        ("languages", "books_languages_link", "language"),
    ] {
        let sql = format!(
            "DELETE FROM {table} \
              WHERE NOT EXISTS (SELECT 1 FROM {link} WHERE {col} = {table}.id)"
        );
        sqlx::query(&sql).execute(&mut **tx).await?;
    }
    delete_orphan_authors(tx).await?;
    delete_orphan_tags(tx).await?;
    delete_orphan_genres(tx).await
}

/// Delete `authors` rows with no book left to justify them: no canonical
/// `books_authors_link` row **and** no creators-override membership on a live
/// book (`materialize_author_rows` creates override-only rows, so a link-only
/// check would reap them). Called from [`delete_orphan_taxonomy`] and directly
/// from the override write paths, which can orphan an author without a link.
pub(crate) async fn delete_orphan_authors(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM authors
          WHERE NOT EXISTS (SELECT 1 FROM books_authors_link WHERE author = authors.id)
            AND NOT EXISTS (
              SELECT 1
                FROM books b
                JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
                JOIN json_each(mo.overrides, '$.creators') je
               WHERE json_type(mo.overrides, '$.creators') IS NOT NULL
                 AND json_extract(je.value, '$.name') = authors.name COLLATE NOCASE
            )",
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Delete `tags` rows with no book left to justify them: no canonical
/// `books_tags_link` row **and** no subjects-override membership on a live book
/// (override memberships live in `metadata_overrides` JSON, so a link-only check
/// would reap a tag an override still names). Called from
/// [`delete_orphan_taxonomy`] and directly from the override write paths.
pub(crate) async fn delete_orphan_tags(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<(), sqlx::Error> {
    // The membership match mirrors `get_tag_cloud`'s override arm; NOCASE equals
    // its `lower()` fold (both ASCII-only) without recomputing it per row.
    sqlx::query(
        "DELETE FROM tags
          WHERE NOT EXISTS (SELECT 1 FROM books_tags_link WHERE tag = tags.id)
            AND NOT EXISTS (
              SELECT 1
                FROM books b
                JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
                JOIN json_each(mo.overrides, '$.subjects') je
               WHERE json_type(mo.overrides, '$.subjects') IS NOT NULL
                 AND je.value = tags.name COLLATE NOCASE
            )",
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Delete `genres` rows no live book's override still names. Genres have no
/// canonical link table, so this is the whole visibility rule: the
/// `metadata_overrides` arm of [`delete_orphan_tags`], with `$.genres` for
/// `$.subjects`. Called from the override write paths (the only way a `genres`
/// row is created) and from [`delete_orphan_taxonomy`].
pub(crate) async fn delete_orphan_genres(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM genres
          WHERE NOT EXISTS (
            SELECT 1
              FROM books b
              JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
              JOIN json_each(mo.overrides, '$.genres') je
             WHERE json_type(mo.overrides, '$.genres') IS NOT NULL
               AND je.value = genres.name COLLATE NOCASE
          )",
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
