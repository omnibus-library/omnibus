//! How far the reader is through a series: one bar (finished, then in
//! progress), the three counts under it, and the book to open next — the one
//! in progress, else the first unread in reading order. Its button says
//! Resume wherever the reader holds a position, Start otherwise. All from the
//! pane's one payload.

use dioxus::prelude::*;
use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

use crate::pages::browse::{
    ago, book_card, current_book, progress_meter, state_of, status_of, tally, BookCard, BookStates,
};
use crate::{reader_route, Route};

/// The book the strip offers next.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NextUp<'a> {
    /// The book in progress the reader touched last.
    Resume(&'a EbookMetadata, &'a BookReading),
    /// The first unread book in reading order. `state` is set when it was
    /// marked unread with a position kept; `fresh` when the reader has
    /// started none of the series.
    Start {
        book: &'a EbookMetadata,
        state: Option<&'a BookReading>,
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
        .map(|book| NextUp::Start {
            book,
            state: state_of(book, states),
            fresh,
        })
}

/// The meta line under the next book: "Book 3 · 42% · read 3 days ago" to
/// resume, "Up next · Book 4" or "Start here · Book 1" to start; each part
/// dropped when unknown.
pub fn next_meta(next: NextUp<'_>, now: i64, zone_secs: Option<i64>) -> String {
    let number = |b: &EbookMetadata| b.series_index.as_ref().map(|i| format!("Book {i}"));
    let percent = |s: Option<&BookReading>| s.and_then(|s| s.percent).map(|p| format!("{p}%"));
    let parts = match next {
        NextUp::Resume(book, state) => vec![
            number(book),
            percent(Some(state)),
            state
                .last_read_at
                .map(|at| format!("read {}", ago(now, at, zone_secs))),
        ],
        NextUp::Start { book, state, fresh } => vec![
            Some(if fresh { "Start here" } else { "Up next" }.to_string()),
            number(book),
            percent(state),
        ],
    };
    parts
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" \u{b7} ")
}

/// What the next book's button says and opens, and the card's test ids.
#[derive(Debug, Clone, PartialEq)]
pub struct NextAction {
    pub label: &'static str,
    pub to: Route,
    pub testid: &'static str,
    pub action_testid: &'static str,
}

/// The button for `next`: Resume where the reader holds a position — the
/// reader opens there whatever the book's status — else Start.
pub fn next_action(next: NextUp<'_>) -> NextAction {
    let (book, state, testid) = match next {
        NextUp::Resume(book, state) => (book, Some(state), "series-current"),
        NextUp::Start { book, state, .. } => (book, state, "series-next"),
    };
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let kept = state.filter(|s| s.format.is_some());
    let to = reader_route(
        uuid,
        kept.and_then(|s| s.format),
        kept.and_then(|s| s.book_file_id),
        &book.formats,
    );
    let (label, action_testid) = if kept.is_some() {
        ("Resume", "series-resume")
    } else {
        ("Start", "series-start")
    };
    NextAction {
        label,
        to,
        testid,
        action_testid,
    }
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
    let book = match next {
        NextUp::Resume(book, _) | NextUp::Start { book, .. } => book,
    };
    let NextAction {
        label,
        to,
        testid,
        action_testid,
    } = next_action(next);
    let card = BookCard {
        book,
        meta: next_meta(next, crate::time::now_unix(), zone_secs),
        action: label,
        to,
        testid,
        action_testid,
    };
    book_card(card, server_url)
}
