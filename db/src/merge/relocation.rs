//! Where every row the merge retargets started, and its replay on undo. Undo
//! sends back exactly the source's rows — positions, sessions, annotations,
//! journals, shelf slots — and leaves anything written on the survivor since.
//!
//! A row is named by its `AUTOINCREMENT` id where the table has one, since
//! those are never reused; otherwise by its primary key minus `book_uuid`.
//! A bare `rowid` is not an identity: SQLite hands a deleted maximum out again.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::Transaction;

use super::transaction::{COLLISION_TABLES, LEDGER_COUNTER_TABLES, RETARGET_TABLES};
use super::MergeError;

/// Tables relocation leaves to someone else. The curation pair is settled by
/// `curation`, which also detects re-curation of the survivor. The content
/// index is regenerated from the files: a book holding any chapters is never
/// re-indexed, so a partial set moved back would stay partial for good.
const UNRELOCATED: [&str; 3] = ["book_read_status", "user_ratings", "book_content_chapters"];

/// A recorded row: its identity (an id number, or a key object) and, for a
/// deleted row, its whole content as `column → value`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct DeletedRow {
    pub id: Value,
    pub row: Map<String, Value>,
}

/// Per table: the identities of the source rows the retarget moved onto the
/// target, and the rows (from either book) a collision dedupe or ledger fold
/// deleted.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct RelocationSnapshot {
    pub moved: BTreeMap<String, Vec<Value>>,
    pub deleted: BTreeMap<String, Vec<DeletedRow>>,
}

/// How a table's rows are named across a merge and its undo.
enum Identity {
    /// The `AUTOINCREMENT` id column.
    Id,
    /// The primary-key columns other than `book_uuid`.
    Key(Vec<String>),
}

/// One table as [`capture_pre`] saw it: `(rowid, identity)` of the source's
/// rows, and `(rowid, row)` of both books' rows where the merge may delete.
/// `rowid` is only compared within the merge transaction, which inserts nothing.
struct PreTable {
    identity: Identity,
    source: Vec<(i64, Value)>,
    rows: Vec<(i64, Map<String, Value>)>,
}

/// What [`capture_pre`] saw, before anything moved.
pub(super) struct PreState(BTreeMap<&'static str, PreTable>);

pub(super) fn relocated_tables() -> impl Iterator<Item = &'static str> {
    RETARGET_TABLES
        .into_iter()
        .filter(|t| !UNRELOCATED.contains(t))
}

/// Whether the merge can delete rows of `table`.
fn records_deletions(table: &str) -> bool {
    COLLISION_TABLES.iter().any(|c| c.table == table)
        || LEDGER_COUNTER_TABLES.iter().any(|(t, _)| *t == table)
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

async fn identity(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<Identity, sqlx::Error> {
    let autoincrement: bool = sqlx::query_scalar(
        "SELECT sql LIKE '%AUTOINCREMENT%' FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table)
    .fetch_one(&mut **tx)
    .await?;
    if autoincrement {
        return Ok(Identity::Id);
    }
    let key: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info(?) WHERE pk > 0 AND name != 'book_uuid' ORDER BY pk",
    )
    .bind(table)
    .fetch_all(&mut **tx)
    .await?;
    Ok(Identity::Key(key))
}

/// `json_object(...)` over `cols`, for a SELECT.
fn json_object(cols: &[String]) -> String {
    let pairs = cols
        .iter()
        .map(|c| format!("'{c}', \"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!("json_object({pairs})")
}

/// Record both books' rows before the dedupe and retarget run.
pub(super) async fn capture_pre(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<PreState, MergeError> {
    let mut pre = BTreeMap::new();
    for table in relocated_tables() {
        let identity = identity(tx, table).await?;
        let id_expr = match &identity {
            Identity::Id => "CAST(id AS TEXT)".to_owned(),
            Identity::Key(cols) => json_object(cols),
        };
        let source: Vec<(i64, String)> = sqlx::query_as(&format!(
            "SELECT rowid, {id_expr} FROM {table} WHERE book_uuid = ?"
        ))
        .bind(source_uuid)
        .fetch_all(&mut **tx)
        .await?;
        let source = source
            .into_iter()
            .map(|(rowid, id)| Ok((rowid, serde_json::from_str(&id)?)))
            .collect::<Result<Vec<_>, serde_json::Error>>()?;

        let mut rows = Vec::new();
        if records_deletions(table) {
            let all = json_object(&columns(tx, table).await?);
            let raw: Vec<(i64, String)> = sqlx::query_as(&format!(
                "SELECT rowid, {all} FROM {table} WHERE book_uuid IN (?, ?)"
            ))
            .bind(source_uuid)
            .bind(target_uuid)
            .fetch_all(&mut **tx)
            .await?;
            for (rowid, json) in raw {
                rows.push((rowid, serde_json::from_str(&json)?));
            }
        }
        pre.insert(
            table,
            PreTable {
                identity,
                source,
                rows,
            },
        );
    }
    Ok(PreState(pre))
}

/// The identity of a whole recorded row.
fn identity_of(identity: &Identity, row: &Map<String, Value>) -> Value {
    match identity {
        Identity::Id => row.get("id").cloned().unwrap_or(Value::Null),
        Identity::Key(cols) => Value::Object(
            cols.iter()
                .map(|c| (c.clone(), row.get(c).cloned().unwrap_or(Value::Null)))
                .collect(),
        ),
    }
}

/// Diff [`capture_pre`] against the target once the retarget has run: what
/// survives there moved, what is gone was deleted.
pub(super) async fn capture_post(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_uuid: &str,
    pre: PreState,
) -> Result<RelocationSnapshot, sqlx::Error> {
    let mut snap = RelocationSnapshot::default();
    for (table, t) in pre.0 {
        let on_target: HashSet<i64> =
            sqlx::query_scalar(&format!("SELECT rowid FROM {table} WHERE book_uuid = ?"))
                .bind(target_uuid)
                .fetch_all(&mut **tx)
                .await?
                .into_iter()
                .collect();
        let moved: Vec<Value> = t
            .source
            .into_iter()
            .filter(|(rowid, _)| on_target.contains(rowid))
            .map(|(_, id)| id)
            .collect();
        if !moved.is_empty() {
            snap.moved.insert(table.to_owned(), moved);
        }
        let deleted: Vec<DeletedRow> = t
            .rows
            .into_iter()
            .filter(|(rowid, _)| !on_target.contains(rowid))
            .map(|(_, row)| DeletedRow {
                id: identity_of(&t.identity, &row),
                row,
            })
            .collect();
        if !deleted.is_empty() {
            snap.deleted.insert(table.to_owned(), deleted);
        }
    }
    Ok(snap)
}

/// `(table, identity)` of every row a merge's dedupe deleted, the identity
/// rendered to JSON so it can be hashed.
pub(super) fn deleted_ids(
    snap: &RelocationSnapshot,
) -> impl Iterator<Item = (String, String)> + '_ {
    snap.deleted
        .iter()
        .flat_map(|(t, rows)| rows.iter().map(move |r| (t.clone(), r.id.to_string())))
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
    deleted_by_later_merges: &HashSet<(String, String)>,
) -> Result<(), MergeError> {
    for (table, ids) in &snap.moved {
        if ids
            .iter()
            .any(|id| deleted_by_later_merges.contains(&(table.clone(), id.to_string())))
        {
            return Err(MergeError::UndoConflict(format!(
                "a later merge into the surviving book replaced a {table} row this merge \
                 moved; undo that merge first"
            )));
        }
    }
    for (table, ids) in &snap.moved {
        for id in ids {
            move_back(tx, table, id, source_uuid, target_uuid).await?;
        }
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

/// Move one row, named by its identity, from the target back to the source.
async fn move_back(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
    id: &Value,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    let matches = match id {
        Value::Object(key) => key
            .keys()
            .map(|c| format!("\"{c}\" = json_extract(?3, '$.\"{c}\"')"))
            .collect::<Vec<_>>()
            .join(" AND "),
        _ => "id = ?3".to_owned(),
    };
    let sql = format!("UPDATE {table} SET book_uuid = ?1 WHERE book_uuid = ?2 AND {matches}");
    let q = sqlx::query(&sql).bind(source_uuid).bind(target_uuid);
    match id {
        Value::Object(_) => q.bind(id.to_string()),
        _ => q.bind(id.as_i64()),
    }
    .execute(&mut **tx)
    .await?;
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

/// Reinsert one recorded row. An `AUTOINCREMENT` id comes back with it, since
/// it was never reused. A foreign key whose referent is gone since (a deleted
/// account, a deleted shelf) nulls the column where the schema would have, and
/// otherwise skips the row — it would have cascaded away.
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
        let value = format!("json_extract(?1, '$.\"{c}\"')");
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
    let sql = format!(
        "INSERT OR IGNORE INTO {table} ({col_list}) SELECT {}{where_clause}",
        exprs.join(", ")
    );
    sqlx::query(&sql)
        .bind(Value::Object(row.row.clone()).to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}
