//! The KOReader side of the annotation store: a listing of what changed since a
//! cursor (plus tombstones for what was deleted), last-write-wins upserts and
//! deletes. Called by the KOReader annotation routes. The cursor is server
//! receipt time, which `updated_at` already is on every write path, so no
//! column is added; a delete always wins over an edit.

use omnibus_shared::HighlightColor;
use sqlx::{sqlite::SqliteRow, Row, Sqlite, SqlitePool, Transaction};

use super::{delete_with_tombstones, HighlightError, LIST_HIGHLIGHTS_LIMIT};
use crate::helpers::CLIENT_CREATED_AT_SQL;

const NOW_SQL: &str = "CAST(strftime('%s','now') AS INTEGER)";

const COLUMNS: &str = "client_id, epub_cfi_range, color, text, note, created_at, updated_at";

/// A CFI-anchored annotation as a KOReader device is shown it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KoreaderAnnotation {
    pub client_id: String,
    pub epub_cfi_range: String,
    pub color: HighlightColor,
    pub text: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What changed in one book since a cursor, and the cursor to ask from next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KoreaderListing {
    pub cursor: i64,
    pub annotations: Vec<KoreaderAnnotation>,
    pub deleted: Vec<String>,
}

/// One device annotation to store. `created_at` dates a new row; `event_at` is
/// when the device last changed it, compared with the stored row's `updated_at`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KoreaderUpsert {
    pub client_id: String,
    pub epub_cfi_range: String,
    pub color: HighlightColor,
    pub text: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    pub event_at: i64,
}

/// How an upsert landed: written, lost to a newer stored row, or refused
/// because the annotation was deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpsertOutcome {
    Applied(KoreaderAnnotation),
    Stale(KoreaderAnnotation),
    Deleted,
}

/// List a user's CFI-anchored annotations in a book changed at or after `since`,
/// and the ids deleted since. `>=` re-lists same-second rows, which is
/// idempotent. Rows lacking a client id are minted one first, leaving
/// `updated_at` alone. `cursor` is the time the read began, or the last row's
/// time when [`LIST_HIGHLIGHTS_LIMIT`] cut the list short.
pub async fn koreader_annotations_since(
    pool: &SqlitePool,
    user_id: i64,
    canonical_book_uuid: &str,
    since: i64,
) -> Result<KoreaderListing, HighlightError> {
    let now: i64 = sqlx::query_scalar(&format!("SELECT {NOW_SQL}"))
        .fetch_one(pool)
        .await?;
    sqlx::query(
        "UPDATE annotations SET client_id = lower(hex(randomblob(16)))
         WHERE user_id = ? AND book_uuid = ? AND client_id IS NULL
           AND epub_cfi_range IS NOT NULL",
    )
    .bind(user_id)
    .bind(canonical_book_uuid)
    .execute(pool)
    .await?;
    let annotations = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM annotations
         WHERE user_id = ? AND book_uuid = ? AND client_id IS NOT NULL
           AND epub_cfi_range IS NOT NULL AND updated_at >= ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?"
    ))
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(since)
    .bind(LIST_HIGHLIGHTS_LIMIT)
    .fetch_all(pool)
    .await?
    .iter()
    .map(row_to_annotation)
    .collect::<Result<Vec<_>, _>>()?;
    let deleted = sqlx::query_scalar(
        "SELECT client_id FROM annotation_tombstones
         WHERE user_id = ? AND book_uuid = ? AND deleted_at >= ?
         ORDER BY deleted_at ASC, client_id ASC",
    )
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(since)
    .fetch_all(pool)
    .await?;
    let capped = annotations.len() as i64 >= LIST_HIGHLIGHTS_LIMIT;
    let cursor = match annotations.last() {
        Some(last) if capped => last.updated_at,
        _ => now,
    };
    Ok(KoreaderListing {
        cursor,
        annotations,
        deleted,
    })
}

/// Store a device annotation under its client id. An existing row is only
/// overwritten when the event time (clamped to now) is no older than its
/// `updated_at`; a landed write stamps `updated_at` with now. A deleted id is
/// never resurrected. `NotFound` when the id belongs to a different book.
pub async fn upsert_koreader_annotation(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    canonical_book_uuid: &str,
    a: &KoreaderUpsert,
) -> Result<UpsertOutcome, HighlightError> {
    let tombstoned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM annotation_tombstones WHERE user_id = ? AND client_id = ?)",
    )
    .bind(user_id)
    .bind(&a.client_id)
    .fetch_one(&mut **tx)
    .await?;
    if tombstoned {
        return Ok(UpsertOutcome::Deleted);
    }
    // A moved CFI voids the Kobo anchor, which the downsync pass derives again.
    let written = sqlx::query(&format!(
        "INSERT INTO annotations
             (user_id, book_uuid, epub_cfi_range, color, text, note, client_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, {CLIENT_CREATED_AT_SQL})
         ON CONFLICT(user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET
             kobo_location = CASE
                 WHEN annotations.epub_cfi_range IS excluded.epub_cfi_range
                     THEN annotations.kobo_location
                 ELSE NULL
             END,
             epub_cfi_range = excluded.epub_cfi_range,
             color = excluded.color,
             text = excluded.text,
             note = excluded.note,
             updated_at = {NOW_SQL}
         WHERE annotations.book_uuid = excluded.book_uuid
           AND MIN(?, {NOW_SQL}) >= annotations.updated_at
         RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(&a.epub_cfi_range)
    .bind(a.color.as_str())
    .bind(a.text.as_deref())
    .bind(a.note.as_deref())
    .bind(&a.client_id)
    .bind(a.created_at)
    .bind(a.event_at)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = written {
        return Ok(UpsertOutcome::Applied(row_to_annotation(&row)?));
    }
    let kept = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM annotations
         WHERE user_id = ? AND book_uuid = ? AND client_id = ?"
    ))
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(&a.client_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(HighlightError::NotFound)?;
    Ok(UpsertOutcome::Stale(row_to_annotation(&kept)?))
}

/// Delete the user's annotations under `client_ids` in this book and leave a
/// tombstone for each. An id from another book, or unknown, is a no-op.
pub async fn delete_koreader_annotations(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    canonical_book_uuid: &str,
    client_ids: &[String],
) -> Result<(), HighlightError> {
    delete_with_tombstones(tx, user_id, Some(canonical_book_uuid), client_ids).await
}

fn row_to_annotation(row: &SqliteRow) -> Result<KoreaderAnnotation, HighlightError> {
    let color: String = row.try_get("color")?;
    Ok(KoreaderAnnotation {
        client_id: row.try_get("client_id")?,
        epub_cfi_range: row.try_get("epub_cfi_range")?,
        color: HighlightColor::parse(&color).unwrap_or(HighlightColor::Amber),
        text: row.try_get("text")?,
        note: row.try_get("note")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
