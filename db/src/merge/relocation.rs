//! Where every row the merge retargets started, and its replay on undo. The
//! record is by `rowid`, which a retarget `UPDATE` preserves, so undo sends back
//! exactly the source's rows — positions, sessions, annotations, journals,
//! shelf slots — and leaves anything written on the survivor since in place.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::Transaction;

use super::transaction::{COLLISION_TABLES, LEDGER_COUNTER_TABLES, RETARGET_TABLES};
use super::MergeError;

/// Settled by `curation`, which also has to detect re-curation of the survivor.
const CURATION_TABLES: [&str; 2] = ["book_read_status", "user_ratings"];

/// Rows at most this many ids per `IN (…)` list, well under SQLite's bind cap.
const ROWID_CHUNK: usize = 500;

/// A row the merge deleted, as `column → value`, with the `rowid` it had.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct DeletedRow {
    pub rowid: i64,
    pub row: Map<String, Value>,
}

/// Per table: the source rows the retarget moved onto the target, and the rows
/// (from either book) a collision dedupe or ledger fold deleted.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct RelocationSnapshot {
    pub moved: BTreeMap<String, Vec<i64>>,
    pub deleted: BTreeMap<String, Vec<DeletedRow>>,
}

/// What [`capture_pre`] saw, before anything moved.
pub(super) struct PreState {
    source_rowids: BTreeMap<&'static str, Vec<i64>>,
    rows: BTreeMap<&'static str, Vec<DeletedRow>>,
}

fn relocated_tables() -> impl Iterator<Item = &'static str> {
    RETARGET_TABLES
        .into_iter()
        .filter(|t| !CURATION_TABLES.contains(t))
}

/// Whether the merge can delete rows of `table` whose content undo needs. The
/// content index is excluded: it is regenerated from the files, and recording
/// it would copy whole chapters into the merge log.
fn records_deletions(table: &str) -> bool {
    let collides = COLLISION_TABLES.iter().any(|c| c.table == table)
        || LEDGER_COUNTER_TABLES.iter().any(|(t, _)| *t == table);
    collides && !CURATION_TABLES.contains(&table) && table != "book_content_chapters"
}

async fn columns(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(&mut **tx)
        .await
}

/// Record both books' rows before the dedupe and retarget run.
pub(super) async fn capture_pre(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<PreState, MergeError> {
    let mut pre = PreState {
        source_rowids: BTreeMap::new(),
        rows: BTreeMap::new(),
    };
    for table in relocated_tables() {
        let ids: Vec<i64> =
            sqlx::query_scalar(&format!("SELECT rowid FROM {table} WHERE book_uuid = ?"))
                .bind(source_uuid)
                .fetch_all(&mut **tx)
                .await?;
        pre.source_rowids.insert(table, ids);
        if !records_deletions(table) {
            continue;
        }
        let pairs = columns(tx, table)
            .await?
            .iter()
            .map(|c| format!("'{c}', \"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let rows: Vec<(i64, String)> = sqlx::query_as(&format!(
            "SELECT rowid, json_object({pairs}) FROM {table} WHERE book_uuid IN (?, ?)"
        ))
        .bind(source_uuid)
        .bind(target_uuid)
        .fetch_all(&mut **tx)
        .await?;
        let mut parsed = Vec::with_capacity(rows.len());
        for (rowid, json) in rows {
            parsed.push(DeletedRow {
                rowid,
                row: serde_json::from_str(&json)?,
            });
        }
        pre.rows.insert(table, parsed);
    }
    Ok(pre)
}

/// Diff [`capture_pre`] against the target once the retarget has run: what
/// survives there moved, what is gone was deleted.
pub(super) async fn capture_post(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_uuid: &str,
    pre: PreState,
) -> Result<RelocationSnapshot, sqlx::Error> {
    let mut snap = RelocationSnapshot::default();
    for (table, source_ids) in pre.source_rowids {
        let on_target: HashSet<i64> =
            sqlx::query_scalar(&format!("SELECT rowid FROM {table} WHERE book_uuid = ?"))
                .bind(target_uuid)
                .fetch_all(&mut **tx)
                .await?
                .into_iter()
                .collect();
        let moved: Vec<i64> = source_ids
            .into_iter()
            .filter(|id| on_target.contains(id))
            .collect();
        if !moved.is_empty() {
            snap.moved.insert(table.to_owned(), moved);
        }
        let deleted: Vec<DeletedRow> = pre
            .rows
            .get(table)
            .into_iter()
            .flatten()
            .filter(|r| !on_target.contains(&r.rowid))
            .cloned()
            .collect();
        if !deleted.is_empty() {
            snap.deleted.insert(table.to_owned(), deleted);
        }
    }
    Ok(snap)
}

/// `(table, rowid)` of every row a merge's dedupe deleted.
pub(super) fn deleted_rowids(
    snap: &RelocationSnapshot,
) -> impl Iterator<Item = (String, i64)> + '_ {
    snap.deleted
        .iter()
        .flat_map(|(t, rows)| rows.iter().map(move |r| (t.clone(), r.rowid)))
}

/// Send the moved rows back to the source and reinsert the deleted ones on the
/// book they were deleted from.
///
/// Refuses when a still-open later merge into the same book deleted one of the
/// rows this merge moved: that row now lives only in the later merge's record,
/// so undoing that merge first is the only way to get it back.
pub(super) async fn restore_relocation(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
    snap: &RelocationSnapshot,
    deleted_by_later_merges: &HashSet<(String, i64)>,
) -> Result<(), MergeError> {
    for (table, ids) in &snap.moved {
        if ids
            .iter()
            .any(|id| deleted_by_later_merges.contains(&(table.clone(), *id)))
        {
            return Err(MergeError::UndoConflict(format!(
                "a later merge into the surviving book replaced a {table} row this merge \
                 moved; undo that merge first"
            )));
        }
    }
    for (table, ids) in &snap.moved {
        move_back(tx, table, ids, source_uuid, target_uuid).await?;
    }
    for (table, rows) in &snap.deleted {
        let bucket = LEDGER_COUNTER_TABLES
            .iter()
            .find(|(t, _)| t == table)
            .map(|(_, b)| *b);
        for row in rows {
            if let Some(bucket) = bucket {
                unfold_ledger_row(tx, table, bucket, row, source_uuid, target_uuid).await?;
            }
            reinsert(tx, table, row).await?;
        }
    }
    Ok(())
}

async fn move_back(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
    ids: &[i64],
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    for chunk in ids.chunks(ROWID_CHUNK) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let sql = format!(
            "UPDATE {table} SET book_uuid = ? WHERE book_uuid = ? AND rowid IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql).bind(source_uuid).bind(target_uuid);
        for id in chunk {
            q = q.bind(id);
        }
        q.execute(&mut **tx).await?;
    }
    Ok(())
}

/// Take a folded source bucket's contribution back off the target's bucket.
async fn unfold_ledger_row(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
    bucket: &str,
    row: &DeletedRow,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    if row.row.get("book_uuid").and_then(Value::as_str) != Some(source_uuid) {
        return Ok(());
    }
    sqlx::query(&format!(
        "UPDATE {table}
            SET percent_gained = MAX(0, percent_gained - json_extract(?1, '$.percent_gained'))
          WHERE book_uuid = ?2
            AND user_id = json_extract(?1, '$.user_id')
            AND format = json_extract(?1, '$.format')
            AND {bucket} = json_extract(?1, '$.{bucket}')"
    ))
    .bind(Value::Object(row.row.clone()).to_string())
    .bind(target_uuid)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Reinsert one recorded row under its old `rowid`. A foreign key whose referent
/// is gone since (a deleted account, a deleted shelf) nulls the column where the
/// schema would have, and otherwise skips the row — it would have cascaded away.
async fn reinsert(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
    row: &DeletedRow,
) -> Result<(), sqlx::Error> {
    let fks: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT \"from\", \"table\", \"to\", on_delete FROM pragma_foreign_key_list(?)",
    )
    .bind(table)
    .fetch_all(&mut **tx)
    .await?;
    let cols: Vec<String> = columns(tx, table)
        .await?
        .into_iter()
        .filter(|c| row.row.contains_key(c))
        .collect();

    let mut exprs = Vec::with_capacity(cols.len());
    let mut conds = Vec::new();
    for c in &cols {
        let value = format!("json_extract(?2, '$.\"{c}\"')");
        let Some((_, parent, to, on_delete)) = fks.iter().find(|(from, ..)| from == c) else {
            exprs.push(value);
            continue;
        };
        let to = to.as_deref().unwrap_or("rowid");
        let exists = format!("EXISTS (SELECT 1 FROM \"{parent}\" WHERE \"{to}\" = {value})");
        if on_delete.eq_ignore_ascii_case("SET NULL") {
            exprs.push(format!("CASE WHEN {exists} THEN {value} END"));
        } else {
            exprs.push(value.clone());
            conds.push(format!("({value} IS NULL OR {exists})"));
        }
    }
    let where_clause = if conds.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conds.join(" AND "))
    };
    let col_list = cols
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    // An `id INTEGER PRIMARY KEY` already *is* the rowid; naming both is an error.
    let (rowid_col, rowid_expr) = if row.row.get("id").and_then(Value::as_i64) == Some(row.rowid) {
        ("", "")
    } else {
        ("rowid, ", "?1, ")
    };
    let sql = format!(
        "INSERT OR IGNORE INTO {table} ({rowid_col}{col_list}) SELECT {rowid_expr}{}{where_clause}",
        exprs.join(", ")
    );
    sqlx::query(&sql)
        .bind(row.rowid)
        .bind(Value::Object(row.row.clone()).to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}
