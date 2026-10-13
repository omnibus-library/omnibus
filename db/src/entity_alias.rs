//! Shared read-side of the `entity_aliases` ledger that
//! `cleanup::entity_ops::write_entity_alias` writes when a library-cleanup
//! merge absorbs an author, series, or tag. Consulted by every taxonomy
//! resolver before it mints a new row, so a later reindex resolves a
//! merged-away entity back to its surviving canonical id.

use std::collections::HashMap;

use omnibus_shared::CleanupKind;
use sqlx::Transaction;

#[cfg(test)]
mod tests;

/// Batched alias lookup: for each of `names`, the canonical id it resolves to
/// if a prior merge recorded it as an alias; a name absent from the returned
/// map was never merged away. The match is `COLLATE NOCASE` (ASCII fold) and
/// the map is keyed by the *input* name (via `eq_ignore_ascii_case`), so callers
/// look it up with the exact string they queried with.
pub(crate) async fn resolve_entity_aliases(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    kind: CleanupKind,
    names: &[&str],
) -> Result<HashMap<String, i64>, sqlx::Error> {
    let mut out = HashMap::new();
    if names.is_empty() {
        return Ok(out);
    }
    // 500 per chunk stays under SQLite's bound-parameter cap alongside the `kind` bind.
    for chunk in names.chunks(500) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT alias_name, canonical_id FROM entity_aliases \
             WHERE kind = ? AND alias_name COLLATE NOCASE IN ({placeholders})"
        );
        let mut q = sqlx::query_as::<_, (String, i64)>(&sql).bind(kind.as_str());
        for name in chunk {
            q = q.bind(*name);
        }
        for (alias_name, canonical_id) in q.fetch_all(&mut **tx).await? {
            for name in chunk.iter().filter(|n| n.eq_ignore_ascii_case(&alias_name)) {
                out.insert((*name).to_string(), canonical_id);
            }
        }
    }
    Ok(out)
}
