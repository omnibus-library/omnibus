//! How far the reader is through a series: one bar (finished, then in
//! progress), the three counts under it, and the book to open next — the one
//! in progress with a Resume, else the first unread in reading order with a
//! Start. All from the pane's one payload.

use dioxus::prelude::*;
use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

use crate::pages::browse::{
    ago, book_card, current_book, progress_meter, status_of, tally, BookCard, BookStates,
};
use crate::reader_route;

/// The book the strip offers next.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NextUp<'a> {
    /// The book in progress the reader touched last.
    Resume(&'a EbookMetadata, &'a BookReading),
    /// The first unread book in reading order; `fresh` when the reader has
    /// started none of the series.
    Start {
        book: &'a EbookMetadata,
        fresh: bool,
    },
}

/// What the strip offers: the book in progress, else the first unread one.
/// `None` once every book is finished.
pub fn next_up<'a>(books: &'a [EbookMetadata], states: &'a BookStates) -> Option<NextUp<'a>> {
    if let Some((book, state)) = current_book(books, states) {
        return Some(NextUp::Resume(book, state));
    }
    let fresh = books
        .iter()
        .all(|b| status_of(b, states) == ReadStatus::Unread);
    books
        .iter()
        .find(|b| status_of(b, states) == ReadStatus::Unread)
        .map(|book| NextUp::Start { book, fresh })
}

/// The meta line under the next book: "Book 3 · 42% · read 3 days ago" to
/// resume, "Up next · Book 4" or "Start here · Book 1" to start; each part
/// dropped when unknown.
pub fn next_meta(next: NextUp<'_>, now: i64, zone_secs: Option<i64>) -> String {
    let number = |b: &EbookMetadata| b.series_index.as_ref().map(|i| format!("Book {i}"));
    let parts = match next {
        NextUp::Resume(book, state) => vec![
            number(book),
            state.percent.map(|p| format!("{p}%")),
            state
                .last_read_at
                .map(|at| format!("read {}", ago(now, at, zone_secs))),
        ],
        NextUp::Start { book, fresh } => vec![
            Some(if fresh { "Start here" } else { "Up next" }.to_string()),
            number(book),
        ],
    };
    parts
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" \u{b7} ")
}

/// The progress strip and, while one is left, the book to open next.
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
    rsx! {
        section { class: "au-reading", "data-testid": "series-reading",
            div { class: "au-progress",
                {progress_meter(books.len(), t)}
                p { class: "au-tally",
                    span { b { "{t.finished}" } " finished" }
                    span { b { "{t.reading}" } " reading" }
                    span { b { "{t.unread}" } " unread" }
                }
            }
            if let Some(next) = next_up(books, states) {
                {next_card(next, server_url, zone_secs)}
            }
        }
    }
}

/// The next book: cover, title, the meta line, and Resume or Start.
fn next_card(next: NextUp<'_>, server_url: &str, zone_secs: Option<i64>) -> Element {
    let meta = next_meta(next, crate::time::now_unix(), zone_secs);
    let card = match next {
        NextUp::Resume(book, state) => BookCard {
            book,
            meta,
            action: "Resume",
            to: reader_route(
                book.unique_identifier.clone().unwrap_or_default(),
                state.format,
                state.book_file_id,
                &book.formats,
            ),
            testid: "series-current",
            action_testid: "series-resume",
        },
        // No position yet, so the reader opens at the start.
        NextUp::Start { book, .. } => BookCard {
            book,
            meta,
            action: "Start",
            to: reader_route(
                book.unique_identifier.clone().unwrap_or_default(),
                None,
                None,
                &book.formats,
            ),
            testid: "series-next",
            action_testid: "series-start",
        },
    };
    book_card(card, server_url)
}
