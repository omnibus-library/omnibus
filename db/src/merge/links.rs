//! The taxonomy links a merge copies from the absorbed book onto the kept one,
//! and their removal on undo. The merge records exactly what it added, by name,
//! so undo can take that back without touching the kept book's own links.

use std::collections::{BTreeMap, HashSet};

use sqlx::Transaction;

use super::snapshot::{SourceSnapshot, TargetAuthorSort};
use super::MergeError;
use crate::sort_keys::refresh_author_sort;

/// A link table the merge unions: its taxonomy column, and the taxonomy table
/// and name column that column points at.
struct LinkTable {
    link: &'static str,
    col: &'static str,
    taxonomy: &'static str,
    name: &'static str,
}

/// Series and language are deliberately absent: a book has one of each, so the
/// kept entry keeps its own and the source's are dropped — unioning them
/// re-languaged the kept entry and filed it under the absorbed book's series.
const LINK_TABLES: [LinkTable; 3] = [
    LinkTable {
        link: "books_authors_link",
        col: "author",
        taxonomy: "authors",
        name: "name",
    },
    LinkTable {
        link: "books_tags_link",
        col: "tag",
        taxonomy: "tags",
        name: "name",
    },
    LinkTable {
        link: "books_publishers_link",
        col: "publisher",
        taxonomy: "publishers",
        name: "name",
    },
];

/// Every link table the source's rows are cleared from.
const ALL_LINK_TABLES: [&str; 5] = [
    "books_authors_link",
    "books_series_link",
    "books_tags_link",
    "books_publishers_link",
    "books_languages_link",
];

/// Names the merge linked onto the kept book that it did not carry before,
/// keyed by link table.
pub(super) type LinksAdded = BTreeMap<String, Vec<String>>;

/// `(link table, lowercased name)` pairs a merged-away book supplies, from its
/// snapshot's own link lists.
pub(super) fn supplied_links(snap: &SourceSnapshot) -> HashSet<(String, String)> {
    let authors = snap
        .authors
        .iter()
        .map(|(n, _, _)| ("books_authors_link", n));
    let tags = snap.tags.iter().map(|n| ("books_tags_link", n));
    let publishers = snap.publishers.iter().map(|n| ("books_publishers_link", n));
    authors
        .chain(tags)
        .chain(publishers)
        .map(|(t, n)| (t.to_owned(), n.to_lowercase()))
        .collect()
}

/// Whether the target has any author link.
async fn has_author_links(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    book_id: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM books_authors_link WHERE book = ?)")
        .bind(book_id)
        .fetch_one(&mut **tx)
        .await
}

/// The target's `author_sort` as it stands before the merge moves links.
pub(super) async fn capture_target_author_sort(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_id: i64,
) -> Result<TargetAuthorSort, sqlx::Error> {
    let before = sqlx::query_scalar("SELECT author_sort FROM books WHERE id = ?")
        .bind(target_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(TargetAuthorSort { before })
}

/// Copy the source's authors, tags and publishers onto the target and clear
/// every source link row. Returns what was added, for undo. The source's
/// authors go **after** the target's, so the kept entry's primary author stays
/// at position 0 and its `author_sort` only re-keys when it had none.
pub(super) async fn move_links(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<LinksAdded, MergeError> {
    let target_had_authors = has_author_links(tx, target_id).await?;
    let mut added = LinksAdded::new();
    for t in &LINK_TABLES {
        let names = copy_link_table(tx, t, source_id, target_id).await?;
        if !names.is_empty() {
            added.insert(t.link.to_owned(), names);
        }
    }
    for table in ALL_LINK_TABLES {
        let sql = format!("DELETE FROM {table} WHERE book = ?");
        sqlx::query(&sql).bind(source_id).execute(&mut **tx).await?;
    }
    if !target_had_authors {
        refresh_author_sort(tx, &[target_id]).await?;
    }
    Ok(added)
}

/// Put the target's `author_sort` back when undo left it with no author links,
/// the one case where the merge's re-key has nothing left to re-derive from.
pub(super) async fn restore_target_author_sort(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_id: i64,
    before: Option<&TargetAuthorSort>,
) -> Result<(), sqlx::Error> {
    let Some(before) = before else { return Ok(()) };
    if has_author_links(tx, target_id).await? {
        return Ok(());
    }
    sqlx::query("UPDATE books SET author_sort = ? WHERE id = ?")
        .bind(&before.before)
        .bind(target_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Hand an undone merge's captured `author_sort` to the next still-open merge
/// into the same target, whose own capture was taken with this merge's authors
/// in place: if that one is undone last, it must put back the key from before both.
pub(super) async fn hand_on_author_sort(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    merge_log_id: i64,
    target_id: i64,
    before: Option<&TargetAuthorSort>,
) -> Result<(), MergeError> {
    let Some(before) = before else { return Ok(()) };
    // Only a snapshot that already has the field: older merges never re-keyed, so none to restore.
    sqlx::query(
        "UPDATE merge_log SET source_metadata = json_set(source_metadata, '$.target_author_sort', json(?))
          WHERE id = (SELECT MIN(id) FROM merge_log
                       WHERE target_book_id = ? AND id > ? AND undone_at IS NULL)
            AND json_type(source_metadata, '$.target_author_sort') IS NOT NULL",
    )
    .bind(serde_json::to_string(before)?)
    .bind(target_id)
    .bind(merge_log_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Copy one link table's source rows onto the target, returning the names
/// that were new to it.
async fn copy_link_table(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    t: &LinkTable,
    source_id: i64,
    target_id: i64,
) -> Result<Vec<String>, sqlx::Error> {
    // Table and column names are fixed literals from `LINK_TABLES`.
    let LinkTable {
        link,
        col,
        taxonomy,
        name,
    } = t;
    let added: Vec<String> = sqlx::query_scalar(&format!(
        "SELECT x.{name} FROM {link} l JOIN {taxonomy} x ON x.id = l.{col}
          WHERE l.book = ?2 AND l.{col} NOT IN (SELECT {col} FROM {link} WHERE book = ?1)
          ORDER BY l.rowid"
    ))
    .bind(target_id)
    .bind(source_id)
    .fetch_all(&mut **tx)
    .await?;
    if *link == "books_authors_link" {
        let next: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM books_authors_link WHERE book = ?",
        )
        .bind(target_id)
        .fetch_one(&mut **tx)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO books_authors_link (book, author, position)
             SELECT ?1, author, ?3 + position FROM books_authors_link WHERE book = ?2",
        )
        .bind(target_id)
        .bind(source_id)
        .bind(next)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(&format!(
            "INSERT OR IGNORE INTO {link} (book, {col}) SELECT ?1, {col} FROM {link} WHERE book = ?2"
        ))
        .bind(target_id)
        .bind(source_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(added)
}

/// Take the links the merge added back off the target.
///
/// Refuses when a still-open later merge's book also supplies one of them —
/// the same last-in-first-out rule as identifiers: that merge recorded the
/// link as added by nobody, so neither stripping nor keeping it here is right.
pub(super) async fn strip_added_links(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_id: i64,
    added: &LinksAdded,
    still_supplied: &HashSet<(String, String)>,
) -> Result<(), MergeError> {
    for t in &LINK_TABLES {
        for value in added.get(t.link).into_iter().flatten() {
            if still_supplied.contains(&(t.link.to_owned(), value.to_lowercase())) {
                return Err(MergeError::UndoConflict(format!(
                    "a later merge into the surviving book also supplies \"{value}\"; \
                     undo that merge first"
                )));
            }
            let LinkTable {
                link,
                col,
                taxonomy,
                name,
            } = t;
            sqlx::query(&format!(
                "DELETE FROM {link} WHERE book = ? AND {col} IN
                    (SELECT id FROM {taxonomy} WHERE {name} = ?)"
            ))
            .bind(target_id)
            .bind(value)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}
