//! The taxonomy links a merge copies from the absorbed book onto the kept one,
//! and their removal on undo. The merge records exactly what it added, by name,
//! so undo can take that back without touching the kept book's own links.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::Transaction;

use super::MergeError;

/// One link table: its taxonomy column, the taxonomy table and that table's
/// name column, and whether the kept book's own value excludes the source's.
struct LinkTable {
    link: &'static str,
    col: &'static str,
    taxonomy: &'static str,
    name: &'static str,
    /// A book has one series and one language in practice, so the source's
    /// only fills a gap. Unioning them is how a merge changed the kept entry's
    /// language and filed it under the absorbed book's series.
    fill_only: bool,
}

const LINK_TABLES: [LinkTable; 4] = [
    LinkTable {
        link: "books_series_link",
        col: "series",
        taxonomy: "series",
        name: "name",
        fill_only: true,
    },
    LinkTable {
        link: "books_tags_link",
        col: "tag",
        taxonomy: "tags",
        name: "name",
        fill_only: false,
    },
    LinkTable {
        link: "books_publishers_link",
        col: "publisher",
        taxonomy: "publishers",
        name: "name",
        fill_only: false,
    },
    LinkTable {
        link: "books_languages_link",
        col: "language",
        taxonomy: "languages",
        name: "code",
        fill_only: true,
    },
];

/// Names the merge linked onto the kept book that it did not carry before.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct LinksAdded {
    pub authors: Vec<String>,
    pub series: Vec<String>,
    pub tags: Vec<String>,
    pub publishers: Vec<String>,
    pub languages: Vec<String>,
}

impl LinksAdded {
    fn for_table(&mut self, link: &str) -> &mut Vec<String> {
        match link {
            "books_series_link" => &mut self.series,
            "books_tags_link" => &mut self.tags,
            "books_publishers_link" => &mut self.publishers,
            _ => &mut self.languages,
        }
    }

    /// `(link table, name)` pairs, the shape a later merge's claims are kept in.
    fn entries(&self) -> impl Iterator<Item = (&'static str, &str)> {
        let authors = self
            .authors
            .iter()
            .map(|n| ("books_authors_link", n.as_str()));
        let rest = [
            ("books_series_link", &self.series),
            ("books_tags_link", &self.tags),
            ("books_publishers_link", &self.publishers),
            ("books_languages_link", &self.languages),
        ]
        .into_iter()
        .flat_map(|(t, names)| names.iter().map(move |n| (t, n.as_str())));
        authors.chain(rest)
    }
}

/// `(link table, lowercased name)` pairs a merged-away book supplies, from its
/// snapshot's own link lists.
pub(super) fn supplied_links(
    authors: &[(String, Option<String>, i64)],
    series: &[String],
    tags: &[String],
    publishers: &[String],
    languages: &[String],
) -> HashSet<(&'static str, String)> {
    let mut out: HashSet<(&'static str, String)> = authors
        .iter()
        .map(|(n, _, _)| ("books_authors_link", n.to_lowercase()))
        .collect();
    for (table, names) in [
        ("books_series_link", series),
        ("books_tags_link", tags),
        ("books_publishers_link", publishers),
        ("books_languages_link", languages),
    ] {
        out.extend(names.iter().map(|n| (table, n.to_lowercase())));
    }
    out
}

/// Copy the source's links onto the target and clear the source's rows.
/// Returns what was added, for undo.
///
/// The source's authors go **after** the target's: sharing position 0 left
/// the credit order to chance, which is how a merge demoted the kept entry's
/// primary author.
pub(super) async fn move_links(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<LinksAdded, sqlx::Error> {
    let mut added = LinksAdded {
        authors: sqlx::query_scalar(
            "SELECT a.name FROM books_authors_link l JOIN authors a ON a.id = l.author
              WHERE l.book = ?2 AND l.author NOT IN
                    (SELECT author FROM books_authors_link WHERE book = ?1)
              ORDER BY l.position",
        )
        .bind(target_id)
        .bind(source_id)
        .fetch_all(&mut **tx)
        .await?,
        ..Default::default()
    };
    let next_position: i64 = sqlx::query_scalar(
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
    .bind(next_position)
    .execute(&mut **tx)
    .await?;

    for t in &LINK_TABLES {
        *added.for_table(t.link) = copy_link_table(tx, t, source_id, target_id).await?;
    }
    for table in std::iter::once("books_authors_link").chain(LINK_TABLES.iter().map(|t| t.link)) {
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
        fill_only,
    } = t;
    if *fill_only {
        let target_has: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS(SELECT 1 FROM {link} WHERE book = ?)"
        ))
        .bind(target_id)
        .fetch_one(&mut **tx)
        .await?;
        if target_has {
            return Ok(Vec::new());
        }
    }
    let added: Vec<String> = sqlx::query_scalar(&format!(
        "SELECT x.{name} FROM {link} l JOIN {taxonomy} x ON x.id = l.{col}
          WHERE l.book = ?2 AND l.{col} NOT IN (SELECT {col} FROM {link} WHERE book = ?1)"
    ))
    .bind(target_id)
    .bind(source_id)
    .fetch_all(&mut **tx)
    .await?;
    sqlx::query(&format!(
        "INSERT OR IGNORE INTO {link} (book, {col}) SELECT ?1, {col} FROM {link} WHERE book = ?2"
    ))
    .bind(target_id)
    .bind(source_id)
    .execute(&mut **tx)
    .await?;
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
    still_supplied: &HashSet<(&'static str, String)>,
) -> Result<(), MergeError> {
    for (link, value) in added.entries() {
        if still_supplied.contains(&(link, value.to_lowercase())) {
            return Err(MergeError::UndoConflict(format!(
                "a later merge into the surviving book also supplies \"{value}\"; \
                 undo that merge first"
            )));
        }
        let (col, taxonomy, name) = match LINK_TABLES.iter().find(|t| t.link == link) {
            Some(t) => (t.col, t.taxonomy, t.name),
            None => ("author", "authors", "name"),
        };
        sqlx::query(&format!(
            "DELETE FROM {link} WHERE book = ? AND {col} IN
                (SELECT id FROM {taxonomy} WHERE {name} = ?)"
        ))
        .bind(target_id)
        .bind(value)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
