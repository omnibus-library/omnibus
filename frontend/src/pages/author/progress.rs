//! How far the reader is through an author: one bar (finished, then in
//! progress), the three counts under it, and the book they're reading now
//! with a Resume. All from the pane's one payload.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

use crate::components::atrium::Cover;
use crate::components::cover_tile::thumb_srcs;
use crate::{reader_route, Route};

use super::BookStates;

/// Finished / reading / unread counts over the author's books.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Tally {
    pub finished: usize,
    pub reading: usize,
    pub unread: usize,
}

/// A book's status for the reader; a book with no state is unread.
pub fn status_of(book: &EbookMetadata, states: &BookStates) -> ReadStatus {
    state_of(book, states).map_or(ReadStatus::Unread, |s| s.status)
}

/// The reader's state on `book`, if they have any.
pub fn state_of<'a>(book: &EbookMetadata, states: &'a BookStates) -> Option<&'a BookReading> {
    states.get(book.unique_identifier.as_deref()?)
}

/// Counts each status across `books`.
pub fn tally(books: &[EbookMetadata], states: &BookStates) -> Tally {
    books.iter().fold(Tally::default(), |mut t, b| {
        match status_of(b, states) {
            ReadStatus::Finished => t.finished += 1,
            ReadStatus::Reading => t.reading += 1,
            ReadStatus::Unread => t.unread += 1,
        }
        t
    })
}

/// The book in progress the reader touched last.
pub fn current_book<'a>(
    books: &'a [EbookMetadata],
    states: &'a BookStates,
) -> Option<(&'a EbookMetadata, &'a BookReading)> {
    books
        .iter()
        .filter_map(|b| Some((b, state_of(b, states)?)))
        .filter(|(_, s)| s.status == ReadStatus::Reading)
        .max_by_key(|(_, s)| s.last_read_at)
}

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

/// "today", "yesterday", "3 days ago", "5 weeks ago", "2 years ago": calendar
/// days in the reader's zone (`zone_secs` east of UTC); whole 24-hour days
/// when the zone is unknown, rather than a guessed midnight.
pub fn ago(now: i64, then: i64, zone_secs: Option<i64>) -> String {
    let days = match zone_secs {
        Some(z) => ((now + z).div_euclid(86_400) - (then + z).div_euclid(86_400)).max(0),
        None => (now - then).max(0) / 86_400,
    };
    let plural = |n: i64, unit: &str| format!("{n} {unit}{} ago", if n == 1 { "" } else { "s" });
    match days {
        0 => "today".to_string(),
        1 => "yesterday".to_string(),
        2..=13 => plural(days, "day"),
        14..=59 => plural(days / 7, "week"),
        60..=729 => plural(days / 30, "month"),
        _ => plural(days / 365, "year"),
    }
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
                {progress_bar(books.len(), t)}
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

/// One bar: the share of books finished, then the share in progress — the
/// same reading as the list row's bar, at the pane's scale.
fn progress_bar(total: usize, t: Tally) -> Element {
    let label = format!("{} of {total} finished, {} reading", t.finished, t.reading);
    let pct = |n: usize| (n as f64 * 100.0 / total.max(1) as f64).floor();
    rsx! {
        div { class: "au-meter", role: "img", "aria-label": "{label}",
            span { class: "au-meter-done", style: "width: {pct(t.finished)}%" }
            span { class: "au-meter-now", style: "width: {pct(t.reading)}%" }
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
    let title = book.display_title();
    let meta = current_meta(book, state, crate::time::now_unix(), zone_secs);
    let resume = reader_route(
        uuid.clone(),
        state.format,
        state.book_file_id,
        &book.formats,
    );
    let (src, srcset) = thumb_srcs(book, &uuid, server_url, 0);
    rsx! {
        div { class: "au-current", "data-testid": "author-current",
            Link {
                to: Route::BookDetail { uuid: uuid.clone() },
                class: "au-current-cover",
                "aria-hidden": "true",
                tabindex: "-1",
                Cover {
                    book: book.clone(),
                    src_override: src,
                    srcset,
                    sizes: Some("64px".to_string()),
                }
            }
            div { class: "au-current-body",
                Link { to: Route::BookDetail { uuid }, class: "au-current-title", "{title}" }
                p { class: "au-current-meta", "{meta}" }
            }
            // A physical-only copy can be marked reading, but there is nothing to open.
            if !book.formats.is_empty() {
                Link {
                    to: crate::routes::link_target(resume),
                    class: "au-resume",
                    "data-testid": "author-resume",
                    "Resume"
                }
            }
        }
    }
}
