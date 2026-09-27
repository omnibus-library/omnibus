//! The taxonomy links a merge copies from the absorbed book onto the kept one,
//! and their removal on undo. The merge records exactly what it added, by name,
//! so undo can take that back without touching the kept book's own links.

use std::collections::{BTreeMap, HashSet};

use sqlx::Transaction;

use super::snapshot::SourceSnapshot;
use super::MergeError;

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

/// Copy the source's authors, tags and publishers onto the target and clear
/// every source link row. Returns what was added, for undo.
///
/// The source's authors go **after** the target's: sharing position 0 left
/// the credit order to chance, which is how a merge demoted the kept entry's
/// primary author.
pub(super) async fn move_links(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<LinksAdded, sqlx::Error> {
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
    Ok(added)
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
