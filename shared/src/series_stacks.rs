//! Series stacks: a series with 2+ books folds into one tile, standing in
//! its first-sorting member's slot. [`stack_books`] groups a client-side
//! list the same way.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::ebook::EbookMetadata;

#[cfg(test)]
mod tests;

/// Your reading state on one book of a series stack.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct StackMemberState {
    pub uuid: String,
    /// Your ebook position as a whole-book percent, from 0 to 100. Null without one.
    #[serde(default)]
    pub percent: Option<u8>,
    /// Whether you have opened the book in any format, meaning it has a status, a percent
    /// or a listening position.
    #[serde(default)]
    pub started: bool,
    #[serde(default)]
    pub finished: bool,
}

/// A series folded into one row of a book list.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SeriesStack {
    /// The uuid of the member that stands in the list. The stack takes that book's place.
    pub lead_uuid: String,
    /// The series name.
    pub name: String,
    /// The series' id, as in `GET /api/series/{id}`. Null when no series record matches.
    #[serde(default)]
    pub series_id: Option<i64>,
    /// Every book of the series that passes the request's filters, in series order.
    pub members: Vec<EbookMetadata>,
    // Empty on stacks a client groups itself with `stack_books`.
    /// Your reading state on each member.
    #[serde(default)]
    pub states: Vec<StackMemberState>,
}

impl SeriesStack {
    /// The viewer's state for member `uuid`, if the stack carries one.
    pub fn state_of(&self, uuid: &str) -> Option<&StackMemberState> {
        self.states.iter().find(|s| s.uuid == uuid)
    }

    /// The volume shown in front: first in-progress, else first in series order.
    pub fn front(&self) -> Option<&EbookMetadata> {
        self.members
            .iter()
            .find(|m| {
                m.unique_identifier
                    .as_deref()
                    .and_then(|u| self.state_of(u))
                    .is_some_and(|s| s.started && !s.finished)
            })
            .or_else(|| self.members.first())
    }
}

/// The key two books must share to stack, matching SQLite's `lower(trim(x))`
/// (spaces only, not general whitespace).
pub fn series_group_key(series: Option<&str>) -> Option<String> {
    let trimmed = series?.trim_matches(' ');
    (!trimmed.is_empty()).then(|| trimmed.to_ascii_lowercase())
}

/// Stack a whole client-side list: each series with 2+ books folds into its
/// first member's slot, members in series order.
pub fn stack_books(books: &[EbookMetadata]) -> (Vec<EbookMetadata>, Vec<SeriesStack>) {
    let mut groups: HashMap<String, Vec<&EbookMetadata>> = HashMap::new();
    for book in books {
        if let Some(key) = series_group_key(book.series.as_deref()) {
            groups.entry(key).or_default().push(book);
        }
    }
    let mut rows = Vec::with_capacity(books.len());
    let mut stacks = Vec::new();
    let mut placed: HashSet<String> = HashSet::new();
    for book in books {
        let key = series_group_key(book.series.as_deref());
        let group = key
            .as_ref()
            .and_then(|k| groups.get(k))
            .filter(|g| g.len() >= 2);
        let (Some(key), Some(group)) = (key, group) else {
            rows.push(book.clone());
            continue;
        };
        if !placed.insert(key) {
            continue;
        }
        let mut members: Vec<EbookMetadata> = group.iter().map(|b| (*b).clone()).collect();
        sort_series_order(&mut members);
        rows.push(book.clone());
        stacks.push(SeriesStack {
            lead_uuid: book.unique_identifier.clone().unwrap_or_default(),
            name: book
                .series
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_string(),
            series_id: book.series_id,
            members,
            states: Vec::new(),
        });
    }
    (rows, stacks)
}

/// Series order: numeric index ascending, unnumbered last; ties break the
/// same way the server's member query does — dictionary title, then id.
fn sort_series_order(members: &mut [EbookMetadata]) {
    members.sort_by(|a, b| {
        match (series_number(a), series_number(b)) {
            (Some(x), Some(y)) => x.total_cmp(&y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
        .then_with(|| title_tie_break(a, b))
    });
}

/// Effective displayed title in dictionary order, then id — the server's tie-break.
fn title_tie_break(a: &EbookMetadata, b: &EbookMetadata) -> Ordering {
    let (a_title, b_title) = (
        a.title.as_deref().unwrap_or(""),
        b.title.as_deref().unwrap_or(""),
    );
    crate::sort_order::dictionary_key(a_title)
        .cmp(&crate::sort_order::dictionary_key(b_title))
        .then_with(|| a.id.cmp(&b.id))
}

fn series_number(book: &EbookMetadata) -> Option<f64> {
    book.series_index
        .as_deref()?
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
}
