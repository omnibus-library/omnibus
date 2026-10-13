//! Materialize the side tables an override touches so downstream reads still
//! resolve: a series-name override gets a canonical row plus link, while
//! subjects (tags), genres and creators (authors) get a vocabulary row only —
//! their memberships stay override-JSON-side (see [`materialize_tag_rows`]).

use std::collections::HashSet;

use omnibus_shared::text_fold::fold_for_match;
use omnibus_shared::MetadataOverrides;
use sqlx::{QueryBuilder, SqliteConnection};

use crate::sync::AUTHOR_UPSERT_CHUNK;

/// Names bound per batched insert. SQLite's default bound-parameter cap is
/// 999 (32766 on newer builds) and a subjects/genres list is user-supplied,
/// so the batch is chunked rather than trusted to stay small — same size and
/// reason as `resolve_entity_aliases` in `crate::entity_alias`.
const INSERT_CHUNK: usize = 500;

/// The single-column vocabulary tables an override materializes rows in.
///
/// A closed enum rather than a `&str` so the table name — the one part of
/// [`insert_vocabulary_rows`]'s statement that can't be a bind — is chosen
/// from this file at compile time and can't be routed in from a call site.
#[derive(Clone, Copy)]
enum VocabularyTable {
    Tags,
    Genres,
}

impl VocabularyTable {
    /// The SQL identifier this variant names.
    fn as_sql(self) -> &'static str {
        match self {
            Self::Tags => "tags",
            Self::Genres => "genres",
        }
    }
}

/// When an override sets a series name, ensure a `series` row and
/// `books_series_link` exist so the browse index and detail-page breadcrumb
/// resolve; override-only series are otherwise invisible to `list_series`.
/// Takes `&mut SqliteConnection` so the caller runs all four statements in one
/// transaction (`&mut tx`): autocommit would reopen the partial-failure window.
pub(super) async fn materialize_series_link(
    conn: &mut SqliteConnection,
    book_uuid: &str,
    overrides: &MetadataOverrides,
) -> Result<(), sqlx::Error> {
    let series_name = overrides
        .series
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(series_name) = series_name else {
        return Ok(());
    };
    let Some(book_id) = lookup_book_id(&mut *conn, book_uuid).await? else {
        return Ok(());
    };
    let series_id = find_or_create_series(&mut *conn, series_name).await?;
    link_book_to_series(&mut *conn, book_id, series_id).await
}

/// When an override sets a subjects list, ensure a `tags` row exists for every
/// tag in it, so `get_tag_cloud` (`/api/tags` and the inline-edit autocomplete)
/// can surface a tag created through the override path. Rows-only, **not**
/// `books_tags_link`: that table is the sole record of *scanned* tags, so
/// writing overrides there would make "delete overrides" unable to revert.
pub(super) async fn materialize_tag_rows(
    conn: &mut SqliteConnection,
    overrides: &MetadataOverrides,
) -> Result<(), sqlx::Error> {
    let Some(subjects) = overrides.subjects.as_ref() else {
        return Ok(());
    };
    insert_vocabulary_rows(conn, VocabularyTable::Tags, subjects).await
}

/// When an override sets a genres list, ensure a `genres` row exists for every
/// entry, so `get_genre_cloud` (`/api/genres` and the chip-editor autocomplete)
/// can surface a genre the moment a user coins it. Rows-only, like
/// [`materialize_tag_rows`], because genres have no scanned baseline: the
/// override JSON is their only storage.
pub(super) async fn materialize_genre_rows(
    conn: &mut SqliteConnection,
    overrides: &MetadataOverrides,
) -> Result<(), sqlx::Error> {
    let Some(genres) = overrides.genres.as_ref() else {
        return Ok(());
    };
    insert_vocabulary_rows(conn, VocabularyTable::Genres, genres).await
}

/// When an override sets a creators list, ensure an `authors` row exists for
/// every name in it. Every read resolves override creators **by name**, so a
/// name living only in override JSON would have no id, author page or
/// `/api/authors` entry. Rows-only, like [`materialize_tag_rows`]; `file_as`
/// seeds `sort` when the row is new, and an existing row keeps its own.
pub(super) async fn materialize_author_rows(
    conn: &mut SqliteConnection,
    overrides: &MetadataOverrides,
) -> Result<(), sqlx::Error> {
    let Some(creators) = overrides.creators.as_ref() else {
        return Ok(());
    };
    let mut seen: HashSet<String> = HashSet::new();
    let rows: Vec<(&str, Option<&str>)> = creators
        .iter()
        .map(|c| {
            let sort = c
                .file_as
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            (c.name.trim(), sort)
        })
        .filter(|(name, _)| !name.is_empty())
        .filter(|(name, _)| seen.insert(name.to_ascii_lowercase()))
        .collect();

    // Three binds per row, so the shared one-column chunk would overrun the
    // parameter cap; the author writers share their own bound.
    for chunk in rows.chunks(AUTHOR_UPSERT_CHUNK) {
        let mut qb = QueryBuilder::new("INSERT OR IGNORE INTO authors (name, sort, name_norm) ");
        qb.push_values(chunk, |mut b, (name, sort)| {
            b.push_bind(*name);
            b.push_bind(*sort);
            b.push_bind(fold_for_match(name));
        });
        qb.build().execute(&mut *conn).await?;
    }
    Ok(())
}

/// `INSERT OR IGNORE` every name in `names` into a single-column vocabulary
/// table (`tags` / `genres`), one multi-row statement per [`INSERT_CHUNK`] chunk.
/// Names are trimmed, blanks dropped, and duplicates collapsed
/// case-insensitively to match the `UNIQUE COLLATE NOCASE` column, so a list
/// naming a tag twice can't make a batch conflict with itself.
async fn insert_vocabulary_rows(
    conn: &mut SqliteConnection,
    table: VocabularyTable,
    names: &[String],
) -> Result<(), sqlx::Error> {
    let mut seen: HashSet<String> = HashSet::new();
    let names: Vec<&str> = names
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|s| seen.insert(s.to_ascii_lowercase()))
        .collect();

    for chunk in names.chunks(INSERT_CHUNK) {
        let mut qb = QueryBuilder::new("INSERT OR IGNORE INTO ");
        qb.push(table.as_sql());
        qb.push(" (name) ");
        qb.push_values(chunk, |mut b, name| {
            b.push_bind(*name);
        });
        qb.build().execute(&mut *conn).await?;
    }
    Ok(())
}

/// Resolve `books.uuid` → `books.id`. Returns `None` if the row was
/// deleted out from under the override write path.
async fn lookup_book_id(
    conn: &mut SqliteConnection,
    book_uuid: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT id FROM books WHERE uuid = ?")
        .bind(book_uuid)
        .fetch_optional(conn)
        .await
}

/// Idempotent series-row materialization: INSERT-OR-IGNORE the name, then
/// SELECT the id case-insensitively so the read matches the same NOCASE
/// uniqueness the canonical scan path uses.
async fn find_or_create_series(
    conn: &mut SqliteConnection,
    series_name: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO series (name) VALUES (?)")
        .bind(series_name)
        .execute(&mut *conn)
        .await?;
    sqlx::query_scalar::<_, i64>("SELECT id FROM series WHERE name = ? COLLATE NOCASE")
        .bind(series_name)
        .fetch_one(conn)
        .await
}

/// Idempotent `books_series_link` insert — repeated overrides on the
/// same (book, series) pair are a no-op.
async fn link_book_to_series(
    conn: &mut SqliteConnection,
    book_id: i64,
    series_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO books_series_link (book, series) VALUES (?, ?)")
        .bind(book_id)
        .bind(series_id)
        .execute(conn)
        .await?;
    Ok(())
}
