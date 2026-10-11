//! Candidate values for the filter picker, mapped from the reads that already
//! feed the tag, genre, author, series and shelf surfaces.

use std::collections::HashMap;

use omnibus_shared::{
    AuthorSummary, FilterClause, FilterField, FilterMode, GenreWeight, SeriesSummary, ShelfKind,
    ShelfSummary, TagWeight, ViewFilters, GENRE_CLOUD_LIMIT, KNOWN_LIBRARY_FORMATS,
    TAG_CLOUD_LIMIT,
};

use crate::data::{self, DataError};
use crate::shelf_access::shows_owner_attribution;

/// One selectable value: what the filter stores, what the reader sees, and how
/// many books carry it when the source says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterOption {
    pub value: String,
    pub label: String,
    pub count: Option<usize>,
}

/// The options a search shows, and how many matched before the cap.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Matches {
    pub shown: Vec<FilterOption>,
    pub total: usize,
}

/// One field's options as loaded, each label lowercased once so a search is a
/// scan rather than an allocation per row on every keystroke.
#[derive(Debug, PartialEq, Eq)]
pub struct OptionList {
    options: Vec<FilterOption>,
    lowered: Vec<String>,
    cap: Option<usize>,
}

impl OptionList {
    /// A list over `options`, complete as far as the source goes.
    pub fn new(options: Vec<FilterOption>) -> Self {
        let lowered = options.iter().map(|o| o.label.to_lowercase()).collect();
        Self {
            options,
            lowered,
            cap: None,
        }
    }

    /// The list noting the source returned only its `cap` most-used values.
    pub fn with_cap(self, cap: Option<usize>) -> Self {
        Self { cap, ..self }
    }

    /// The most-used rows the source cut its answer to, when it did.
    pub fn cap(&self) -> Option<usize> {
        self.cap
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    /// The options whose label contains `query`, at most `limit` of them.
    pub fn matching(&self, query: &str, limit: usize) -> Matches {
        let needle = query.trim().to_lowercase();
        let mut hits = self
            .options
            .iter()
            .zip(&self.lowered)
            .filter(|(_, label)| label.contains(&needle))
            .map(|(option, _)| option);
        let shown: Vec<FilterOption> = hits.by_ref().take(limit).cloned().collect();
        Matches {
            total: shown.len() + hits.count(),
            shown,
        }
    }
}

/// Tag cloud rows as options.
pub fn tag_options(tags: Vec<TagWeight>) -> Vec<FilterOption> {
    named_options(
        FilterField::Tag,
        tags.into_iter().map(|t| (t.name, t.count)),
    )
}

/// Tag cloud rows as a list that remembers when the cloud was full.
pub fn tag_list(tags: Vec<TagWeight>) -> OptionList {
    let cap = (tags.len() >= TAG_CLOUD_LIMIT).then_some(TAG_CLOUD_LIMIT);
    OptionList::new(tag_options(tags)).with_cap(cap)
}

/// Genre cloud rows as a list that remembers when the cloud was full.
pub fn genre_list(genres: Vec<GenreWeight>) -> OptionList {
    let cap = (genres.len() >= GENRE_CLOUD_LIMIT).then_some(GENRE_CLOUD_LIMIT);
    OptionList::new(genre_options(genres)).with_cap(cap)
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

/// A shelf's name, followed by its owner's when it is another reader's, so
/// two shelves with one name stay apart.
pub fn shelf_label(shelf: &ShelfSummary, viewer_id: Option<i64>) -> String {
    if shows_owner_attribution(viewer_id, shelf.owner_user_id, shelf.kind) {
        format!("{} \u{b7} {}", shelf.name, shelf.owner_username)
    } else {
        shelf.name.clone()
    }
}

/// Hand-picked and wishlist shelves as options, valued by shelf id.
pub fn shelf_options(shelves: &[ShelfSummary], viewer_id: Option<i64>) -> Vec<FilterOption> {
    shelves
        .iter()
        .filter(|s| s.kind != ShelfKind::Smart)
        .map(|s| FilterOption {
            value: s.id.to_string(),
            label: shelf_label(s, viewer_id),
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
    viewer_id: Option<i64>,
) -> Result<OptionList, DataError> {
    match field {
        FilterField::Tag => data::get_tag_cloud(server_url).await.map(tag_list),
        FilterField::Genre => data::get_genre_cloud(server_url).await.map(genre_list),
        FilterField::Author => data::list_authors(server_url)
            .await
            .map(|rows| OptionList::new(author_options(rows))),
        FilterField::Series => data::list_series(server_url)
            .await
            .map(|rows| OptionList::new(series_options(rows))),
        FilterField::Shelf => data::list_shelves(server_url)
            .await
            .map(|shelves| OptionList::new(shelf_options(&shelves, viewer_id))),
        FilterField::Format => Ok(OptionList::new(format_options())),
    }
}
