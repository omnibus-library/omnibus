//! `metadata_overrides` across a merge and its undo. The kept book's overrides
//! win outright; the absorbed book's row is parked in the snapshot so undo can
//! put it back verbatim.

use omnibus_shared::MetadataOverrides;
use serde::{Deserialize, Serialize};
use sqlx::Transaction;

use super::MergeError;

/// A whole `metadata_overrides` row, minus its key.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub(super) struct OverrideRow {
    pub overrides: String,
    pub has_cover_override: i64,
    pub updated_by: Option<i64>,
    pub updated_at: i64,
    pub title_norm: Option<String>,
    pub author_norm: Option<String>,
}

/// What the merge did to both books' overrides.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct OverridesRecord {
    /// The absorbed book's row, deleted by the merge.
    pub source: Option<OverrideRow>,
    /// The keys the merge filled on the target from the source.
    pub filled: MetadataOverrides,
    /// Whether the target had a row of its own before the merge.
    pub target_had_row: bool,
}

async fn load_row(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    uuid: &str,
) -> Result<Option<OverrideRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT overrides, has_cover_override, updated_by, updated_at, title_norm, author_norm
           FROM metadata_overrides WHERE book_uuid = ?",
    )
    .bind(uuid)
    .fetch_optional(&mut **tx)
    .await
}

/// Settle the source's overrides: the target keeps every key it has, and only
/// the fields nothing scans — genres and print page count — fill in where the
/// target has none. Every other key overrides a scanned value the target
/// already answers, so adopting it would rename, re-credit or re-language the
/// kept entry. The source's row is deleted and returned for undo.
pub(super) async fn merge_overrides(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
    merged_by: Option<i64>,
) -> Result<OverridesRecord, MergeError> {
    let Some(source_row) = load_row(tx, source_uuid).await? else {
        return Ok(OverridesRecord::default());
    };
    let source_ov: MetadataOverrides = serde_json::from_str(&source_row.overrides)?;
    let target_row = load_row(tx, target_uuid).await?;
    let target_ov: MetadataOverrides = match &target_row {
        Some(row) => serde_json::from_str(&row.overrides)?,
        None => MetadataOverrides::default(),
    };

    let filled = MetadataOverrides {
        genres: target_ov
            .genres
            .is_none()
            .then(|| source_ov.genres.clone())
            .flatten(),
        print_pages: target_ov
            .print_pages
            .is_none()
            .then_some(source_ov.print_pages)
            .flatten(),
        ..Default::default()
    };
    if filled != MetadataOverrides::default() {
        sqlx::query(
            "INSERT INTO metadata_overrides (book_uuid, overrides, updated_by, updated_at)
             VALUES (?, ?, ?, strftime('%s','now'))
             ON CONFLICT(book_uuid) DO UPDATE SET
               overrides = excluded.overrides,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at",
        )
        .bind(target_uuid)
        .bind(serde_json::to_string(&target_ov.merge(&filled))?)
        .bind(merged_by)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query("DELETE FROM metadata_overrides WHERE book_uuid = ?")
        .bind(source_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(OverridesRecord {
        source: Some(source_row),
        filled,
        target_had_row: target_row.is_some(),
    })
}

/// Reverse [`merge_overrides`]: the source gets its row back verbatim, and a
/// key the merge filled on the target comes off it — unless it has been edited
/// since, in which case the later edit is the authority and stays.
pub(super) async fn restore_overrides(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
    rec: &OverridesRecord,
) -> Result<(), MergeError> {
    if let Some(row) = &rec.source {
        sqlx::query(
            "INSERT OR REPLACE INTO metadata_overrides
                (book_uuid, overrides, has_cover_override, updated_by, updated_at,
                 title_norm, author_norm)
             SELECT ?, ?, ?, (SELECT id FROM users WHERE id = ?), ?, ?, ?",
        )
        .bind(source_uuid)
        .bind(&row.overrides)
        .bind(row.has_cover_override)
        .bind(row.updated_by)
        .bind(row.updated_at)
        .bind(&row.title_norm)
        .bind(&row.author_norm)
        .execute(&mut **tx)
        .await?;
    }
    if rec.filled == MetadataOverrides::default() {
        return Ok(());
    }
    let Some(current) = load_row(tx, target_uuid).await? else {
        return Ok(());
    };
    let mut ov: MetadataOverrides = serde_json::from_str(&current.overrides)?;
    if rec.filled.genres.is_some() && ov.genres == rec.filled.genres {
        ov.genres = None;
    }
    if rec.filled.print_pages.is_some() && ov.print_pages == rec.filled.print_pages {
        ov.print_pages = None;
    }
    if !rec.target_had_row && ov == MetadataOverrides::default() && current.has_cover_override == 0
    {
        sqlx::query("DELETE FROM metadata_overrides WHERE book_uuid = ?")
            .bind(target_uuid)
            .execute(&mut **tx)
            .await?;
    } else {
        sqlx::query("UPDATE metadata_overrides SET overrides = ? WHERE book_uuid = ?")
            .bind(serde_json::to_string(&ov)?)
            .bind(target_uuid)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
