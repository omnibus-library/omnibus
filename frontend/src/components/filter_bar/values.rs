//! Candidate values for the filter picker, mapped from the reads that already
//! feed the tag, genre, author, series and shelf surfaces.

use std::collections::HashMap;

use omnibus_shared::{
    AuthorSummary, FilterClause, FilterField, FilterMode, GenreWeight, SeriesSummary, ShelfKind,
    ShelfSummary, TagWeight, ViewFilters, KNOWN_LIBRARY_FORMATS,
};

use crate::data::{self, DataError};

/// One selectable value: what the filter stores, what the reader sees, and how
/// many books carry it when the source says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterOption {
    pub value: String,
    pub label: String,
    pub count: Option<usize>,
}

/// The options a search shows, and how many matched before the cap.
#[derive(Debug, PartialEq, Eq)]
pub struct Matches<'a> {
    pub shown: Vec<&'a FilterOption>,
    pub total: usize,
}

/// Tag cloud rows as options.
pub fn tag_options(tags: Vec<TagWeight>) -> Vec<FilterOption> {
    named_options(
        FilterField::Tag,
        tags.into_iter().map(|t| (t.name, t.count)),
    )
}

/// Genre cloud rows as options.
pub fn genre_options(genres: Vec<GenreWeight>) -> Vec<FilterOption> {
    named_options(
        FilterField::Genre,
        genres.into_iter().map(|g| (g.name, g.count)),
    )
}

/// Author index rows as options.
pub fn author_options(authors: Vec<AuthorSummary>) -> Vec<FilterOption> {
    named_options(
        FilterField::Author,
        authors.into_iter().map(|a| (a.name, a.book_count)),
    )
}

/// Series index rows as options.
pub fn series_options(series: Vec<SeriesSummary>) -> Vec<FilterOption> {
    named_options(
        FilterField::Series,
        series.into_iter().map(|s| (s.name, s.book_count)),
    )
}

/// Hand-picked and wishlist shelves as options, valued by shelf id.
pub fn shelf_options(shelves: Vec<ShelfSummary>) -> Vec<FilterOption> {
    shelves
        .into_iter()
        .filter(|s| s.kind != ShelfKind::Smart)
        .map(|s| FilterOption {
            value: s.id.to_string(),
            label: s.name,
            count: usize::try_from(s.book_count).ok(),
        })
        .collect()
}

/// The scanner-indexed formats as options.
pub fn format_options() -> Vec<FilterOption> {
    KNOWN_LIBRARY_FORMATS
        .iter()
        .map(|format| FilterOption {
            value: (*format).to_string(),
            label: format.to_ascii_uppercase(),
            count: None,
        })
        .collect()
}

/// The options whose label contains `query`, at most `limit` of them.
pub fn matching<'a>(options: &'a [FilterOption], query: &str, limit: usize) -> Matches<'a> {
    let needle = query.trim().to_lowercase();
    let hits: Vec<&FilterOption> = options
        .iter()
        .filter(|option| option.label.to_lowercase().contains(&needle))
        .collect();
    Matches {
        total: hits.len(),
        shown: hits.into_iter().take(limit).collect(),
    }
}

/// Options for a field matched by name. The engine compares names ignoring
/// ASCII case, so spellings that differ only by case are one option, and a
/// name the filter would reject is left out rather than offered and refused.
fn named_options(
    field: FilterField,
    rows: impl IntoIterator<Item = (String, usize)>,
) -> Vec<FilterOption> {
    let mut options: Vec<FilterOption> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (name, count) in rows {
        let name = name.trim();
        if !is_accepted(field, name) {
            continue;
        }
        match seen.get(&name.to_ascii_lowercase()) {
            Some(&at) => {
                if let Some(total) = options[at].count.as_mut() {
                    *total += count;
                }
            }
            None => {
                seen.insert(name.to_ascii_lowercase(), options.len());
                options.push(FilterOption {
                    value: name.to_string(),
                    label: name.to_string(),
                    count: Some(count),
                });
            }
        }
    }
    options
}

/// Whether `value` passes the same validation a posted filter does.
fn is_accepted(field: FilterField, value: &str) -> bool {
    ViewFilters {
        clauses: vec![FilterClause::new(field, FilterMode::Include, &[value])],
    }
    .validate()
    .is_ok()
}

/// Read the candidate values for `field` from the server.
pub async fn load_options(
    server_url: &str,
    field: FilterField,
) -> Result<Vec<FilterOption>, DataError> {
    match field {
        FilterField::Tag => data::get_tag_cloud(server_url).await.map(tag_options),
        FilterField::Genre => data::get_genre_cloud(server_url).await.map(genre_options),
        FilterField::Author => data::list_authors(server_url).await.map(author_options),
        FilterField::Series => data::list_series(server_url).await.map(series_options),
        FilterField::Shelf => data::list_shelves(server_url).await.map(shelf_options),
        FilterField::Format => Ok(format_options()),
    }
}
