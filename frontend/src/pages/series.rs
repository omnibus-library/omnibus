//! The series pane beside the series list: the series at a glance, how far
//! the reader is through it and which book comes next, and its books in
//! reading order. Rendered for `/series/:id`, and for `/series`' preview with
//! `preview` set.
//!
//! Everything here comes from one `get_series` read, which carries the
//! reader's state on each book (`SeriesDetail::reading`), so the progress
//! strip and the cover bars paint with the books, not after them.

use dioxus::prelude::*;
use omnibus_shared::SeriesDetail;

use crate::components::loading::Stale;
use crate::components::{Loading, LoadingKind, PageError, PageNotFound};
use crate::{data, use_server_url, Route};

use super::browse::BookStates;

mod books;
mod hero;
mod progress;

use books::series_books;
use hero::{series_authors, SeriesHero, STACK};
use progress::reading_strip;

/// The series pane. `preview` marks `/series`' stand-in: it leaves the page
/// title to the index.
#[component]
pub fn SeriesPage(id: i64, #[props(default)] preview: bool) -> Element {
    let server_url = use_server_url();
    let mut series: Signal<Option<SeriesDetail>> = use_signal(|| None);
    let mut loading = use_signal(|| true);
    let mut error: Signal<Option<String>> = use_signal(|| None);
    crate::use_page_title(move || {
        if preview {
            Some("Series".into())
        } else {
            series.read().as_ref().map(|s| s.name.clone())
        }
    });

    // See `BookDetailPage` for why `id` needs `use_reactive!`.
    let url = server_url.clone();
    let generation = crate::use_cache_generation();
    let mut wanted = use_signal(|| id);
    // The reader's zone for "read today"; asked in the effect, as rule 07 wants.
    let mut zone_secs: Signal<Option<i64>> = use_signal(|| None);
    use_effect(use_reactive!(|id| {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        wanted.set(id);
        let url = url.clone();
        spawn(async move {
            loading.set(true);
            let reply = data::get_series(&url, id).await;
            // Clicking down the list outruns the network: a reply for a
            // series the reader has already left must not land on the next.
            if *wanted.peek() != id {
                return;
            }
            zone_secs.set(crate::time::local_utc_offset_minutes().map(|m| m * 60));
            match reply {
                Ok(s) => {
                    series.set(s);
                    error.set(None);
                }
                Err(e) => error.set(Some(e.to_string())),
            }
            loading.set(false);
        });
    }));

    let current = series();
    let stale = loading() && current.as_ref().is_some_and(|s| s.id != id);
    match (current, error()) {
        // A failed refetch of the series on screen keeps it there.
        (Some(s), err) if s.id == id || err.is_none() => rsx! {
            // A different series still on screen while this one loads stays,
            // dimmed, rather than blanking the pane between two clicks.
            Stale { stale, {render_series(s, &server_url, zone_secs())} }
        },
        (_, Some(msg)) if !loading() => rsx! {
            PageError { message: msg, back_to: Route::SeriesIndex {} }
        },
        (None, None) if !loading() => rsx! {
            PageNotFound { subject: "Series", back_to: Route::SeriesIndex {} }
        },
        _ => rsx! {
            Loading { kind: LoadingKind::Section, label: "Gathering the series" }
        },
    }
}

/// The loaded pane: hero, the reader's progress, then the books in order.
fn render_series(mut s: SeriesDetail, server_url: &str, zone_secs: Option<i64>) -> Element {
    // The first cover-derived accent tints the pane (`authors.css` evens out
    // its lightness); the theme's otherwise.
    let accent = s
        .books
        .iter()
        .find_map(|b| b.accent.clone())
        .unwrap_or_else(|| "var(--accent)".to_string());
    let states: BookStates = std::mem::take(&mut s.reading)
        .into_iter()
        .map(|r| (r.book_uuid.clone(), r))
        .collect();
    let books = std::mem::take(&mut s.books);
    rsx! {
        article {
            key: "{s.id}",
            class: "au-pane",
            style: "--au-accent: {accent}",
            "data-testid": "series-pane",
            SeriesHero {
                name: s.name.clone(),
                stack: books.iter().take(STACK).cloned().collect::<Vec<_>>(),
                authors: series_authors(&books),
                book_count: s.book_count,
                server_url: server_url.to_string(),
            }
            {reading_strip(&books, &states, server_url, zone_secs)}
            {series_books(books, &states, server_url)}
        }
    }
}

#[cfg(test)]
mod tests;
