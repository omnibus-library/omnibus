//! How far the reader is through an author: one bar (finished, then in
//! progress), the three counts under it, and the book they're reading now
//! with a Resume. All from the pane's one payload.

use dioxus::prelude::*;
use omnibus_shared::{BookReading, EbookMetadata};

use crate::pages::browse::{
    ago, book_card, current_book, progress_meter, tally, BookCard, BookStates,
};
use crate::reader_route;

/// The meta line under the current book: "Earthsea 2 · 42% · read 3 days ago",
/// each part dropped when unknown.
pub fn current_meta(
    book: &EbookMetadata,
    state: &BookReading,
    now: i64,
    zone_secs: Option<i64>,
) -> String {
    let series = book.series.as_ref().map(|s| match &book.series_index {
        Some(i) => format!("{s} {i}"),
        None => s.clone(),
    });
    let percent = state.percent.map(|p| format!("{p}%"));
    let when = state
        .last_read_at
        .map(|at| format!("read {}", ago(now, at, zone_secs)));
    [series, percent, when]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" \u{b7} ")
}

/// The progress strip and, when there is one, the book in progress.
pub fn reading_strip(
    books: &[EbookMetadata],
    states: &BookStates,
    server_url: &str,
    zone_secs: Option<i64>,
) -> Element {
    if books.is_empty() {
        return rsx! {};
    }
    let t = tally(books, states);
    let current = current_book(books, states);
    rsx! {
        section { class: "au-reading", "data-testid": "author-reading",
            div { class: "au-progress",
                {progress_meter(books.len(), t)}
                p { class: "au-tally",
                    span { b { "{t.finished}" } " finished" }
                    span { b { "{t.reading}" } " reading" }
                    span { b { "{t.unread}" } " unread" }
                }
            }
            if let Some((book, state)) = current {
                {current_card(book, state, server_url, zone_secs)}
            }
        }
    }
}

/// The book in progress: cover, title, where the reader is, and Resume.
fn current_card(
    book: &EbookMetadata,
    state: &BookReading,
    server_url: &str,
    zone_secs: Option<i64>,
) -> Element {
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let card = BookCard {
        book,
        meta: current_meta(book, state, crate::time::now_unix(), zone_secs),
        action: "Resume",
        to: reader_route(uuid, state.format, state.book_file_id, &book.formats),
        testid: "author-current",
        action_testid: "author-resume",
    };
    book_card(card, server_url)
}
