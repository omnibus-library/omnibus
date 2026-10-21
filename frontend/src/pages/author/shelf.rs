//! The author's books shelved by series — each under its name, a count of
//! books and how many the reader finished, and a link to the series page —
//! then everything outside a series. Every cover carries the reader's
//! progress as a thin bar under it.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{EbookMetadata, ReadStatus};

use crate::components::atrium::Cover;
use crate::components::cover_tile::thumb_srcs;
use crate::Route;

use super::progress::{state_of, status_of};
use super::BookStates;

/// One series' books, in the order the author read returned them.
#[derive(Debug, Clone, PartialEq)]
pub struct SeriesShelf {
    pub name: String,
    /// `0` for a series name with no `series` row behind it (no page to open).
    pub id: i64,
    pub books: Vec<EbookMetadata>,
}

/// Groups books by series in first-seen order, standalones apart.
pub fn group_by_series(books: Vec<EbookMetadata>) -> (Vec<SeriesShelf>, Vec<EbookMetadata>) {
    let mut shelves: Vec<SeriesShelf> = Vec::new();
    let mut standalone = Vec::new();
    for book in books {
        let Some(name) = book.series.clone() else {
            standalone.push(book);
            continue;
        };
        match shelves.iter_mut().find(|s| s.name == name) {
            Some(shelf) => shelf.books.push(book),
            None => shelves.push(SeriesShelf {
                name,
                id: book.series_id.unwrap_or(0),
                books: vec![book],
            }),
        }
    }
    (shelves, standalone)
}

/// How many distinct series `books` span.
pub fn series_count(books: &[EbookMetadata]) -> usize {
    let mut names: Vec<&str> = books.iter().filter_map(|b| b.series.as_deref()).collect();
    names.sort_unstable();
    names.dedup();
    names.len()
}

/// "6 books · 1 finished", leaving out none finished.
pub fn shelf_meta(books: &[EbookMetadata], states: &BookStates) -> String {
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

/// Every series shelf, then "Other works".
pub fn author_shelves(books: Vec<EbookMetadata>, states: &BookStates, server_url: &str) -> Element {
    let (shelves, standalone) = group_by_series(books);
    rsx! {
        div { class: "au-shelves",
            for shelf in shelves.into_iter() {
                section { key: "{shelf.id}-{shelf.name}", class: "au-shelf",
                    header { class: "au-shelf-head",
                        h3 { class: "au-shelf-title", "{shelf.name}" }
                        span { class: "au-shelf-meta", "{shelf_meta(&shelf.books, states)}" }
                        if shelf.id > 0 {
                            Link {
                                to: Route::SeriesDetail { id: shelf.id },
                                class: "au-shelf-link",
                                "aria-label": "{shelf.name} series page",
                                "data-testid": "author-series-link",
                                "Series page"
                            }
                        }
                    }
                    {shelf_grid(shelf.books, states, server_url)}
                }
            }
            if !standalone.is_empty() {
                section { class: "au-shelf",
                    header { class: "au-shelf-head",
                        h3 { class: "au-shelf-title", "Other works" }
                        span { class: "au-shelf-meta", "{shelf_meta(&standalone, states)}" }
                    }
                    {shelf_grid(standalone, states, server_url)}
                }
            }
        }
    }
}

/// A row of covers.
fn shelf_grid(books: Vec<EbookMetadata>, states: &BookStates, server_url: &str) -> Element {
    rsx! {
        div { class: "au-grid", role: "list",
            for book in books.into_iter() {
                {shelf_tile(book, states, server_url)}
            }
        }
    }
}

/// One cover, the reader's bar under it, and the title.
fn shelf_tile(book: EbookMetadata, states: &BookStates, server_url: &str) -> Element {
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
                span { class: "au-tile-title", "{title}" }
            }
        }
    }
}
