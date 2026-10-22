//! The author pane beside the authors list: who they are, how far the reader
//! is through them, and their books shelved by series. Rendered for
//! `/authors/:id`, and for `/authors`' preview with `preview` set.
//!
//! Everything here comes from one `get_author` read, which carries the
//! reader's state on each book (`AuthorDetail::reading`), so the progress
//! strip and the cover bars paint with the books, not after them.

use dioxus::prelude::*;
use omnibus_shared::AuthorDetail;

use crate::components::loading::Stale;
use crate::components::{Loading, LoadingKind, PageError, PageNotFound};
use crate::{data, use_server_url, Route};

use super::browse::BookStates;

#[cfg(not(feature = "mobile"))]
mod delete;
mod hero;
mod progress;
mod shelf;

use hero::AuthorHero;
use progress::reading_strip;
use shelf::author_shelves;

/// The author pane. `preview` marks `/authors`' stand-in: it leaves the page
/// title to the index.
#[component]
pub fn AuthorPage(id: i64, #[props(default)] preview: bool) -> Element {
    let server_url = use_server_url();
    let mut author: Signal<Option<AuthorDetail>> = use_signal(|| None);
    let mut loading = use_signal(|| true);
    let mut error: Signal<Option<String>> = use_signal(|| None);
    crate::use_page_title(move || {
        if preview {
            Some("Authors".into())
        } else {
            author.read().as_ref().map(|a| a.name.clone())
        }
    });
    // Admin-only affordances start hidden: `false` until the session
    // resolves, so SSR and the first client paint match (rule 07).
    let is_admin = crate::use_is_admin();

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
            let reply = data::get_author(&url, id).await;
            // Clicking down the list outruns the network: a reply for an
            // author the reader has already left must not land on the next.
            if *wanted.peek() != id {
                return;
            }
            zone_secs.set(crate::time::local_utc_offset_minutes().map(|m| m * 60));
            match reply {
                Ok(a) => {
                    author.set(a);
                    error.set(None);
                }
                Err(e) => error.set(Some(e.to_string())),
            }
            loading.set(false);
        });
    }));

    let current = author();
    let stale = loading() && current.as_ref().is_some_and(|a| a.id != id);
    match (current, error()) {
        // A failed refetch of the author on screen keeps them there.
        (Some(a), err) if a.id == id || err.is_none() => rsx! {
            // A different author still on screen while this one loads stays,
            // dimmed, rather than blanking the pane between two clicks.
            Stale { stale, {render_author(a, server_url, author, is_admin(), zone_secs())} }
        },
        (_, Some(msg)) if !loading() => rsx! {
            PageError { message: msg, back_to: Route::AuthorsIndex {} }
        },
        (None, None) if !loading() => rsx! {
            PageNotFound { subject: "Author", back_to: Route::AuthorsIndex {} }
        },
        _ => rsx! {
            Loading { kind: LoadingKind::Section, label: "Finding the author" }
        },
    }
}

/// The loaded pane: hero, the reader's progress, then the shelves.
fn render_author(
    mut a: AuthorDetail,
    server_url: String,
    author: Signal<Option<AuthorDetail>>,
    is_admin: bool,
    zone_secs: Option<i64>,
) -> Element {
    // The first cover-derived accent tints the pane (`authors.css` evens out
    // its lightness); the theme's otherwise.
    let accent = a
        .books
        .iter()
        .find_map(|b| b.accent.clone())
        .unwrap_or_else(|| "var(--accent)".to_string());
    let states: BookStates = std::mem::take(&mut a.reading)
        .into_iter()
        .map(|r| (r.book_uuid.clone(), r))
        .collect();
    let books = std::mem::take(&mut a.books);
    rsx! {
        article {
            key: "{a.id}",
            class: "au-pane",
            style: "--au-accent: {accent}",
            "data-testid": "author-pane",
            AuthorHero {
                id: a.id,
                name: a.name.clone(),
                has_photo: a.has_photo,
                book_count: a.book_count,
                series_count: shelf::series_count(&books),
                server_url: server_url.clone(),
                author,
                is_admin,
            }
            {reading_strip(&books, &states, &server_url, zone_secs)}
            {author_shelves(books, &states, &server_url)}
        }
    }
}

#[cfg(test)]
mod tests;
