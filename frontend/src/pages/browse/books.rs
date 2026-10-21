//! The reader's state on each book in a browser's pane: tallies of it, the
//! book in progress, how long ago one was read, the bar that sums it up, the
//! card that opens one book, and the grid of covers each carrying its bar.

use std::collections::HashMap;

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

use crate::components::atrium::Cover;
use crate::components::cover_tile::thumb_srcs;
use crate::Route;

/// The reader's state on each of a pane's books, by book uuid.
pub type BookStates = HashMap<String, BookReading>;

/// Finished / reading / unread counts over a pane's books.
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

/// One bar: the share of `total` books finished, then the share in progress
/// — the same reading as a list row's bar, at the pane's scale.
pub fn progress_meter(total: usize, t: Tally) -> Element {
    let label = format!("{} of {total} finished, {} reading", t.finished, t.reading);
    let pct = |n: usize| (n as f64 * 100.0 / total.max(1) as f64).floor();
    rsx! {
        div { class: "au-meter", role: "img", "aria-label": "{label}",
            span { class: "au-meter-done", style: "width: {pct(t.finished)}%" }
            span { class: "au-meter-now", style: "width: {pct(t.reading)}%" }
        }
    }
}

/// What [`book_card`] shows and where its button goes.
pub struct BookCard<'a> {
    pub book: &'a EbookMetadata,
    /// The line under the title, such as "42% · read 3 days ago".
    pub meta: String,
    /// The button's label, such as "Resume".
    pub action: &'static str,
    /// Where the button opens the book.
    pub to: Route,
    pub testid: &'static str,
    pub action_testid: &'static str,
}

/// One book with a way in: cover, title, the meta line, and the button.
pub fn book_card(card: BookCard<'_>, server_url: &str) -> Element {
    let BookCard {
        book,
        meta,
        action,
        to,
        testid,
        action_testid,
    } = card;
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let title = book.display_title();
    let (src, srcset) = thumb_srcs(book, &uuid, server_url, 0);
    rsx! {
        div { class: "au-current", "data-testid": testid,
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
                    to: crate::routes::link_target(to),
                    class: "au-resume",
                    "data-testid": action_testid,
                    "{action}"
                }
            }
        }
    }
}

/// "6 books · 1 finished", leaving out none finished.
pub fn books_meta(books: &[EbookMetadata], states: &BookStates) -> String {
    let n = books.len();
    let finished = books
        .iter()
        .filter(|b| status_of(b, states) == ReadStatus::Finished)
        .count();
    let count = if n == 1 {
        "1 book".to_string()
    } else {
        format!("{n} books")
    };
    match finished {
        0 => count,
        f => format!("{count} \u{b7} {f} finished"),
    }
}

/// A grid of covers, each over the line `caption` gives it, if any.
pub fn book_grid(
    books: Vec<EbookMetadata>,
    states: &BookStates,
    server_url: &str,
    caption: fn(&EbookMetadata) -> Option<String>,
) -> Element {
    rsx! {
        div { class: "au-grid", role: "list",
            for book in books.into_iter() {
                {book_tile(book, states, server_url, caption)}
            }
        }
    }
}

/// One cover, the reader's bar under it, the caption, and the title.
fn book_tile(
    book: EbookMetadata,
    states: &BookStates,
    server_url: &str,
    caption: fn(&EbookMetadata) -> Option<String>,
) -> Element {
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let title = book.display_title();
    let (src, srcset) = thumb_srcs(&book, &uuid, server_url, 0);
    // Finished is a full bar; in progress shows its percent, with a sliver
    // when the reader is in but no percent is known yet.
    let bar = match (
        status_of(&book, states),
        state_of(&book, states).and_then(|s| s.percent),
    ) {
        (ReadStatus::Finished, _) => Some(100),
        (ReadStatus::Reading, p) => Some(p.unwrap_or(0).clamp(3, 100)),
        (ReadStatus::Unread, _) => None,
    };
    let id = book.id;
    let caption = caption(&book);
    rsx! {
        // The list role sits on a wrapper so the tile stays a link to assistive tech.
        div { key: "{id}", class: "au-tile-item", role: "listitem",
            Link {
                to: Route::BookDetail { uuid },
                class: "au-tile",
                "aria-label": "Open details for {title}",
                Cover {
                    book,
                    src_override: src,
                    srcset,
                    sizes: Some("(max-width: 720px) 30vw, 150px".to_string()),
                }
                span { class: "au-tile-bar", "aria-hidden": "true",
                    if let Some(pct) = bar {
                        span { class: "au-tile-fill", style: "width: {pct}%" }
                    }
                }
                if let Some(caption) = caption {
                    span { class: "au-tile-caption", "{caption}" }
                }
                span { class: "au-tile-title", "{title}" }
            }
        }
    }
}
