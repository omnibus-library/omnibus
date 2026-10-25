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

/// Where a device's listing of one book left off, as two independent positions: the last row
/// seen by `(updated_at, id)` and the last tombstone by `(deleted_at, client_id)`. Rows and
/// tombstones page separately, so neither a second shared by more rows than a page holds nor a
/// long run of deletes can stall a device. It is opaque on the wire: a device stores the string
/// and sends it back, and a bare integer (a time, as older plugins stored) still reads as one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct KoreaderCursor {
    row_at: i64,
    row_id: i64,
    tomb_at: i64,
    tomb_client_id: String,
}

impl KoreaderCursor {
    /// Read a cursor this module issued, or a bare non-negative integer; `None` for anything else.
    pub fn parse(raw: &str) -> Option<Self> {
        let digits = |s: &str| {
            (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                .then(|| s.parse::<i64>().ok())
                .flatten()
        };
        if !raw.contains('.') {
            let at = digits(raw)?;
            return Some(Self {
                row_at: at,
                tomb_at: at,
                ..Self::default()
            });
        }
        let parts: Vec<&str> = raw.split('.').collect();
        let [row_at, row_id, tomb_at, tomb_client_id] = parts.as_slice() else {
            return None;
        };
        Some(Self {
            row_at: digits(row_at)?,
            row_id: digits(row_id)?,
            tomb_at: digits(tomb_at)?,
            tomb_client_id: unhex(tomb_client_id)?,
        })
    }

    /// The wire form: four dot-separated parts, the client id in hex so it needs no escaping.
    pub fn encode(&self) -> String {
        let hex: String = self
            .tomb_client_id
            .bytes()
            .map(|b| format!("{b:02x}"))
            .collect();
        format!("{}.{}.{}.{hex}", self.row_at, self.row_id, self.tomb_at)
    }
}

fn unhex(hex: &str) -> Option<String> {
    if !hex.len().is_multiple_of(2) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect();
    String::from_utf8(bytes?).ok()
}

/// One page of what changed in a book since a cursor: the cursor to ask from next, and `more`
/// when either list was cut at [`LIST_HIGHLIGHTS_LIMIT`] and the device should ask again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KoreaderListing {
    pub cursor: KoreaderCursor,
    pub annotations: Vec<KoreaderAnnotation>,
    pub deleted: Vec<String>,
    pub more: bool,
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

/// List a user's CFI-anchored annotations in a book and the ids deleted, from `since` on.
/// Same-second rows are re-listed, which is idempotent. Rows lacking a client id are minted
/// one first, leaving `updated_at` alone. When a list is cut at [`LIST_HIGHLIGHTS_LIMIT`] its
/// cursor position is its last entry; otherwise it is the time the read began.
pub async fn koreader_annotations_since(
    pool: &SqlitePool,
    user_id: i64,
    canonical_book_uuid: &str,
    since: &KoreaderCursor,
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
    let rows = sqlx::query(&format!(
        "SELECT id, {COLUMNS} FROM annotations
         WHERE user_id = ? AND book_uuid = ? AND client_id IS NOT NULL
           AND epub_cfi_range IS NOT NULL
           AND (updated_at > ? OR (updated_at = ? AND id > ?))
         ORDER BY updated_at ASC, id ASC
         LIMIT ?"
    ))
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(since.row_at)
    .bind(since.row_at)
    .bind(since.row_id)
    .bind(LIST_HIGHLIGHTS_LIMIT)
    .fetch_all(pool)
    .await?;
    let tombstones: Vec<(String, i64)> = sqlx::query_as(
        "SELECT client_id, deleted_at FROM annotation_tombstones
         WHERE user_id = ? AND book_uuid = ?
           AND (deleted_at > ? OR (deleted_at = ? AND client_id > ?))
         ORDER BY deleted_at ASC, client_id ASC
         LIMIT ?",
    )
    .bind(user_id)
    .bind(canonical_book_uuid)
    .bind(since.tomb_at)
    .bind(since.tomb_at)
    .bind(&since.tomb_client_id)
    .bind(LIST_HIGHLIGHTS_LIMIT)
    .fetch_all(pool)
    .await?;

    let rows_cut = rows.len() as i64 >= LIST_HIGHLIGHTS_LIMIT;
    let tombstones_cut = tombstones.len() as i64 >= LIST_HIGHLIGHTS_LIMIT;
    let mut cursor = KoreaderCursor {
        row_at: now,
        tomb_at: now,
        ..KoreaderCursor::default()
    };
    if let (true, Some(last)) = (rows_cut, rows.last()) {
        cursor.row_at = last.try_get("updated_at")?;
        cursor.row_id = last.try_get("id")?;
    }
    if let (true, Some((client_id, deleted_at))) = (tombstones_cut, tombstones.last()) {
        cursor.tomb_at = *deleted_at;
        cursor.tomb_client_id = client_id.clone();
    }
    Ok(KoreaderListing {
        cursor,
        annotations: rows
            .iter()
            .map(row_to_annotation)
            .collect::<Result<_, _>>()?,
        deleted: tombstones.into_iter().map(|(id, _)| id).collect(),
        more: rows_cut || tombstones_cut,
    })
}

/// Store a device annotation under its client id. An existing row is only
/// overwritten when the event time (clamped to now) is no older than its
/// `updated_at`; a landed write stamps `updated_at` with now. A deleted id is
/// never resurrected. `NotFound` when the id belongs to, or was deleted from, a different book.
pub async fn upsert_koreader_annotation(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    canonical_book_uuid: &str,
    a: &KoreaderUpsert,
) -> Result<UpsertOutcome, HighlightError> {
    let tombstone: Option<String> = sqlx::query_scalar(
        "SELECT book_uuid FROM annotation_tombstones WHERE user_id = ? AND client_id = ?",
    )
    .bind(user_id)
    .bind(&a.client_id)
    .fetch_optional(&mut **tx)
    .await?;
    match tombstone {
        Some(book) if book == canonical_book_uuid => return Ok(UpsertOutcome::Deleted),
        Some(_) => return Err(HighlightError::NotFound),
        None => {}
    }
    // A moved CFI flags the Kobo anchor stale, kept served until the downsync derives the new one.
    let written = sqlx::query(&format!(
        "INSERT INTO annotations
             (user_id, book_uuid, epub_cfi_range, color, text, note, client_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, {CLIENT_CREATED_AT_SQL})
         ON CONFLICT(user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET
             kobo_location_stale = CASE
                 WHEN annotations.epub_cfi_range IS excluded.epub_cfi_range
                     THEN annotations.kobo_location_stale
                 ELSE 1
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
