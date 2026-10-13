//! Retiring pending `dedup_suggestions` rows that have stopped describing the
//! library. Detection is idempotent but never subtractive on its own — a row
//! written once stays pending until somebody decides it — so a suggestion
//! outlives the thing it names and the queue keeps offering to delete authors
//! that are already gone.
//!
//! Decided rows are never pruned: they are the ledger that stops detection
//! re-suggesting what was already reviewed. Rows whose payload this build
//! cannot read are kept too (each clause requires its key to be present), so
//! `review_queue` reports them instead of a prune destroying them unseen.

use omnibus_shared::{CleanupAction, CleanupKind};
use sqlx::SqlitePool;

use super::{DetectedSuggestion, MergeEntity};

/// Delete every pending suggestion whose target no longer exists, so the
/// dashboard stops counting a card for a row deleted elsewhere (deleting an
/// author never runs detection). Returns how many rows were retired.
pub async fn prune_stale_suggestions(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let mut removed = 0;
    for entity in [MergeEntity::Author, MergeEntity::Series, MergeEntity::Tag] {
        removed += prune_missing_merge(pool, entity).await?;
    }
    removed += prune_missing_single(pool, CleanupKind::Tag, CleanupAction::Split, "tags").await?;
    removed +=
        prune_missing_single(pool, CleanupKind::Author, CleanupAction::Delete, "authors").await?;
    removed += prune_stale_renames(pool).await?;
    Ok(removed)
}

/// Retire merge suggestions with no survivor to merge into, or nothing left to
/// merge: the canonical row is gone, or every source is. Deliberately not "any
/// source is gone": a group that lost one of three duplicates is still a real
/// merge of the remaining two. `table` is [`MergeEntity`]'s own constant, never
/// caller text.
async fn prune_missing_merge(pool: &SqlitePool, entity: MergeEntity) -> Result<u64, sqlx::Error> {
    let table = entity.table();
    // Guard both keys: without a `source_ids` array `json_each` yields nothing,
    // which would read as "no surviving source" and delete an unreadable row.
    let sql = format!(
        "DELETE FROM dedup_suggestions
          WHERE decision = 'pending' AND kind = ? AND action = 'merge'
            AND json_extract(payload_json, '$.canonical_id') IS NOT NULL
            AND json_type(payload_json, '$.source_ids') = 'array'
            AND (NOT EXISTS (SELECT 1 FROM {table} t
                              WHERE t.id = json_extract(payload_json, '$.canonical_id'))
                 OR NOT EXISTS (SELECT 1 FROM json_each(payload_json, '$.source_ids') s
                                 WHERE EXISTS (SELECT 1 FROM {table} t WHERE t.id = s.value)))"
    );
    Ok(sqlx::query(&sql)
        .bind(entity.kind().as_str())
        .execute(pool)
        .await?
        .rows_affected())
}

/// Retire a split or delete suggestion whose one entity is gone. Both payload
/// shapes name exactly one row, under different keys.
///
/// `table` is a module constant chosen by the caller alongside `kind`, never
/// text from outside this file.
async fn prune_missing_single(
    pool: &SqlitePool,
    kind: CleanupKind,
    action: CleanupAction,
    table: &'static str,
) -> Result<u64, sqlx::Error> {
    let id_key = match action {
        CleanupAction::Split => "$.source_id",
        _ => "$.entity_id",
    };
    let sql = format!(
        "DELETE FROM dedup_suggestions
          WHERE decision = 'pending' AND kind = ? AND action = ?
            AND json_extract(payload_json, '{id_key}') IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM {table} t
                             WHERE t.id = json_extract(payload_json, '{id_key}'))"
    );
    Ok(sqlx::query(&sql)
        .bind(kind.as_str())
        .bind(action.as_str())
        .execute(pool)
        .await?
        .rows_affected())
}

/// Retire a rename whose book has gone, has been retitled underneath it, or now
/// carries a title override: accepting a rename and the metadata edit form both
/// write one, and a human-settled title must stop being offered a proposal.
async fn prune_stale_renames(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "DELETE FROM dedup_suggestions
          WHERE decision = 'pending' AND kind = 'book_title' AND action = 'rename'
            AND json_extract(payload_json, '$.book_uuid') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM books b
                LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
               WHERE b.uuid = json_extract(payload_json, '$.book_uuid')
                 AND b.title = json_extract(payload_json, '$.current_title')
                 AND json_type(mo.overrides, '$.title') IS NULL)",
    )
    .execute(pool)
    .await?
    .rows_affected())
}

/// Delete pending suggestions of the kinds a detection pass just covered that
/// the pass did not re-emit: those whose rows still exist but which detection no
/// longer considers real, which [`prune_stale_suggestions`] cannot see. `kinds`
/// scopes the delete to the kinds the pass ran.
pub async fn prune_undetected(
    pool: &SqlitePool,
    kinds: &[CleanupKind],
    fresh: &[DetectedSuggestion],
) -> Result<u64, sqlx::Error> {
    let mut removed = 0;
    for kind in kinds {
        let payloads: Vec<String> = fresh
            .iter()
            .filter(|s| s.kind == *kind)
            .filter_map(|s| serde_json::to_string(&s.payload).ok())
            .collect();
        // An empty array is the honest answer, not a reason to skip: a kind
        // that detects nothing at all must retire its whole pending backlog.
        let json = serde_json::to_string(&payloads).unwrap_or_else(|_| "[]".to_string());
        removed += sqlx::query(
            "DELETE FROM dedup_suggestions
              WHERE decision = 'pending' AND kind = ?
                AND payload_json NOT IN (SELECT value FROM json_each(?))",
        )
        .bind(kind.as_str())
        .bind(json)
        .execute(pool)
        .await?
        .rows_affected();
    }
    Ok(removed)
}

#[cfg(test)]
mod tests;
