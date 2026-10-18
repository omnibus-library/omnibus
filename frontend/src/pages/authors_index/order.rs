//! Ordering, filtering and letter-grouping for the authors list. Pure, so the
//! list pane's one memo can run the whole pipeline and the rules are tested
//! without a renderer.

use std::collections::HashMap;

use omnibus_shared::sort_order::{creator_sort_key, dictionary_cmp};
use omnibus_shared::{text_fold::fold_for_match, AuthorReading, AuthorSort, AuthorSummary};

/// The reader's progress per author id, once it has loaded.
pub type ReadingMap = HashMap<i64, AuthorReading>;

/// Output of [`compute_author_groups`]: the visible rows in order, and the same
/// rows bucketed by surname letter when the sort is by surname (else empty).
#[derive(Clone, PartialEq)]
pub struct AuthorGroups {
    pub filtered: Vec<AuthorSummary>,
    pub letters: Vec<(char, Vec<AuthorSummary>)>,
}

/// The list's inputs besides the rows themselves.
#[derive(Clone, Copy)]
pub struct ListQuery<'a> {
    pub text: &'a str,
    pub sort: AuthorSort,
    /// `None` until the reader's progress loads (or if it fails to).
    pub reading: Option<&'a ReadingMap>,
    /// Keep only authors with a book in progress; ignored without `reading`.
    pub only_reading: bool,
}

/// Filter → sort → group-by-letter, in one step so a single memo reruns it.
pub fn compute_author_groups(all: &[AuthorSummary], query: ListQuery<'_>) -> AuthorGroups {
    let q = fold_for_match(query.text);
    let mut filtered = filter_authors(all, &q);
    if let (true, Some(map)) = (query.only_reading, query.reading) {
        filtered.retain(|a| map.get(&a.id).is_some_and(|r| r.reading > 0));
    }
    sort_authors(&mut filtered, query.sort, query.reading);
    let filtered: Vec<AuthorSummary> = filtered.into_iter().cloned().collect();
    let letters = group_by_letter(&filtered, query.sort == AuthorSort::Name);
    AuthorGroups { filtered, letters }
}

/// Client-side name filter; `query` must already be folded.
pub fn filter_authors<'a>(all: &'a [AuthorSummary], query: &str) -> Vec<&'a AuthorSummary> {
    if query.is_empty() {
        all.iter().collect()
    } else {
        all.iter()
            .filter(|a| fold_for_match(&a.name).contains(query))
            .collect()
    }
}

/// Sorts `filtered` in place along `sort`. `Recent` puts the authors read
/// most recently first and the never-read after them, by surname.
pub fn sort_authors(
    filtered: &mut [&AuthorSummary],
    sort: AuthorSort,
    reading: Option<&ReadingMap>,
) {
    let by_name = |a: &AuthorSummary, b: &AuthorSummary| {
        let (ka, kb) = (sort_key(a), sort_key(b));
        // Non-alpha keys trail the alphabet under '#', as their letter does.
        is_non_alpha_key(&ka)
            .cmp(&is_non_alpha_key(&kb))
            .then_with(|| dictionary_cmp(&ka, &kb))
    };
    match sort {
        AuthorSort::Name => filtered.sort_by(|a, b| by_name(a, b)),
        AuthorSort::BookCount => {
            filtered.sort_by(|a, b| b.book_count.cmp(&a.book_count).then_with(|| by_name(a, b)))
        }
        AuthorSort::Recent => {
            let last = |a: &AuthorSummary| reading.and_then(|m| m.get(&a.id)?.last_read_at);
            filtered.sort_by(|a, b| last(b).cmp(&last(a)).then_with(|| by_name(a, b)));
        }
    }
}

/// Buckets consecutive same-letter rows of an already-sorted list; empty
/// when `show_letters` is false.
pub fn group_by_letter(
    filtered: &[AuthorSummary],
    show_letters: bool,
) -> Vec<(char, Vec<AuthorSummary>)> {
    let mut letters: Vec<(char, Vec<AuthorSummary>)> = Vec::new();
    if show_letters {
        for a in filtered {
            let l = first_letter(a);
            match letters.last_mut() {
                Some((existing, group)) if *existing == l => group.push(a.clone()),
                _ => letters.push((l, vec![a.clone()])),
            }
        }
    }
    letters
}

/// The author `/authors` shows before the reader picks one: whoever they
/// read most recently, else the first by surname. `None` for an empty library.
pub fn default_author(all: &[AuthorSummary], reading: Option<&ReadingMap>) -> Option<i64> {
    let recent = reading.and_then(|map| {
        all.iter()
            .filter_map(|a| Some((map.get(&a.id)?.last_read_at?, a.id)))
            .max()
            .map(|(_, id)| id)
    });
    recent.or_else(|| {
        let mut rows: Vec<&AuthorSummary> = all.iter().collect();
        sort_authors(&mut rows, AuthorSort::Name, None);
        rows.first().map(|a| a.id)
    })
}

/// The row's name as (surname, given names) from its surname-first key:
/// "Le Guin, Ursula K." → ("Le Guin", "Ursula K."); a mononym has no rest.
pub fn name_parts(a: &AuthorSummary) -> (String, String) {
    let key = sort_key(a);
    match key.split_once(", ") {
        Some((last, rest)) => (last.to_string(), rest.to_string()),
        None => (key, String::new()),
    }
}

/// URL-fragment-safe slug for a letter glyph: `#` would start a second
/// fragment, so the non-alpha bucket is `letter-hash`.
pub fn letter_frag(c: char) -> String {
    if c == '#' {
        "hash".to_string()
    } else {
        c.to_string()
    }
}

/// The letter an author files under: the folded initial of their surname
/// key, or `#` for anything outside A–Z (digits, punctuation, CJK, …). An
/// accented initial files under its letter (`Éluard` under E).
pub fn first_letter(a: &AuthorSummary) -> char {
    match folded_initial(&sort_key(a)) {
        Some(c) if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
        _ => '#',
    }
}

/// Whether `key` files under `#` rather than A–Z.
pub fn is_non_alpha_key(key: &str) -> bool {
    !folded_initial(key).is_some_and(|c| c.is_ascii_alphabetic())
}

/// The key's first character with accents and case folded away.
fn folded_initial(key: &str) -> Option<char> {
    fold_for_match(key.chars().next()?.encode_utf8(&mut [0; 4]))
        .chars()
        .next()
}

/// Surname-first key driving order and letter: `creator_sort_key`, the rule
/// the library's Author axis keys books by. A comma-form `sort` is used
/// verbatim; a comma-less one is ignored and the key derives from the name.
pub fn sort_key(a: &AuthorSummary) -> String {
    creator_sort_key(a.sort.as_deref(), &a.name)
}

#[cfg(test)]
mod tests;
