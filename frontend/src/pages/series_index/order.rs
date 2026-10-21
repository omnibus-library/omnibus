//! Ordering, filtering and letter-grouping for the series list. Pure, so the
//! list pane's one memo can run the whole pipeline and the rules are tested
//! without a renderer.

use std::collections::HashMap;

use omnibus_shared::sort_order::dictionary_cmp;
use omnibus_shared::{text_fold::fold_for_match, BrowseSort, SeriesReading, SeriesSummary};

use crate::pages::browse::{is_non_alpha_key, letter_for_key, Groups};

/// The reader's progress per series id, once it has loaded.
pub type ReadingMap = HashMap<i64, SeriesReading>;

/// Output of [`compute_series_groups`]: the visible rows in order, and the
/// same rows bucketed by letter when the sort is by name (else empty).
pub type SeriesGroups = Groups<SeriesSummary>;

/// The list's inputs besides the rows themselves.
#[derive(Clone, Copy)]
pub struct ListQuery<'a> {
    pub text: &'a str,
    pub sort: BrowseSort,
    /// `None` until the reader's progress loads (or if it fails to).
    pub reading: Option<&'a ReadingMap>,
    /// Keep only series with a book in progress; ignored without `reading`.
    pub only_reading: bool,
}

/// Filter → sort → group-by-letter, in one step so a single memo reruns it.
pub fn compute_series_groups(all: &[SeriesSummary], query: ListQuery<'_>) -> SeriesGroups {
    let q = fold_for_match(query.text);
    let mut filtered = filter_series(all, &q);
    if let (true, Some(map)) = (query.only_reading, query.reading) {
        filtered.retain(|s| map.get(&s.id).is_some_and(|r| r.reading > 0));
    }
    sort_series(&mut filtered, query.sort, query.reading);
    let filtered: Vec<SeriesSummary> = filtered.into_iter().cloned().collect();
    let letters = if query.sort == BrowseSort::Name {
        crate::pages::browse::group_by_letter(&filtered, first_letter)
    } else {
        Vec::new()
    };
    SeriesGroups { filtered, letters }
}

/// Client-side filter on the series' name or its author; `query` must
/// already be folded.
pub fn filter_series<'a>(all: &'a [SeriesSummary], query: &str) -> Vec<&'a SeriesSummary> {
    if query.is_empty() {
        return all.iter().collect();
    }
    let hit = |text: &str| fold_for_match(text).contains(query);
    all.iter()
        .filter(|s| hit(&s.name) || s.primary_author.as_deref().is_some_and(hit))
        .collect()
}

/// Sorts `filtered` in place along `sort`. `Recent` puts the series read most
/// recently first and the never-read after them, by name.
pub fn sort_series(
    filtered: &mut [&SeriesSummary],
    sort: BrowseSort,
    reading: Option<&ReadingMap>,
) {
    let by_name = |a: &SeriesSummary, b: &SeriesSummary| {
        let (ka, kb) = (sort_key(a), sort_key(b));
        // Non-alpha keys trail the alphabet under '#', as their letter does.
        is_non_alpha_key(&ka)
            .cmp(&is_non_alpha_key(&kb))
            .then_with(|| dictionary_cmp(&ka, &kb))
    };
    match sort {
        BrowseSort::Name => filtered.sort_by(|a, b| by_name(a, b)),
        BrowseSort::BookCount => {
            filtered.sort_by(|a, b| b.book_count.cmp(&a.book_count).then_with(|| by_name(a, b)))
        }
        BrowseSort::Recent => {
            let last = |s: &SeriesSummary| reading.and_then(|m| m.get(&s.id)?.last_read_at);
            filtered.sort_by(|a, b| last(b).cmp(&last(a)).then_with(|| by_name(a, b)));
        }
    }
}

/// The series `/series` shows before the reader picks one: the one they read
/// most recently, else the first by name. `None` for an empty library.
pub fn default_series(all: &[SeriesSummary], reading: Option<&ReadingMap>) -> Option<i64> {
    let recent = reading.and_then(|map| {
        all.iter()
            .filter_map(|s| Some((map.get(&s.id)?.last_read_at?, s.id)))
            .max()
            .map(|(_, id)| id)
    });
    recent.or_else(|| {
        let mut rows: Vec<&SeriesSummary> = all.iter().collect();
        sort_series(&mut rows, BrowseSort::Name, None);
        rows.first().map(|s| s.id)
    })
}

/// The letter a series files under: [`letter_for_key`] of its sort key.
pub fn first_letter(s: &SeriesSummary) -> char {
    letter_for_key(&sort_key(s))
}

/// The key a series sorts and files by: its stored sort when it has one, else
/// its name without a leading "The ", so "The Expanse" files under E.
pub fn sort_key(s: &SeriesSummary) -> String {
    if let Some(v) = s.sort.as_deref().filter(|v| !v.is_empty()) {
        return v.to_string();
    }
    let n = &s.name;
    let stripped = n.strip_prefix("The ").or_else(|| n.strip_prefix("the "));
    stripped.unwrap_or(n).to_string()
}

#[cfg(test)]
mod tests;
