//! The author's books shelved by series — each under its name, a count of
//! books and how many the reader finished, and a link to the series page —
//! then everything outside a series. Every cover carries the reader's
//! progress as a thin bar under it.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::EbookMetadata;

use crate::pages::browse::{book_grid, books_meta, BookStates};
use crate::Route;

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

/// Every series shelf, then "Other works".
pub fn author_shelves(books: Vec<EbookMetadata>, states: &BookStates, server_url: &str) -> Element {
    let (shelves, standalone) = group_by_series(books);
    rsx! {
        div { class: "au-shelves",
            for shelf in shelves.into_iter() {
                section { key: "{shelf.id}-{shelf.name}", class: "au-shelf",
                    header { class: "au-shelf-head",
                        h3 { class: "au-shelf-title", "{shelf.name}" }
                        span { class: "au-shelf-meta", "{books_meta(&shelf.books, states)}" }
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
                    {book_grid(shelf.books, states, server_url, |_| None)}
                }
            }
            if !standalone.is_empty() {
                section { class: "au-shelf",
                    header { class: "au-shelf-head",
                        h3 { class: "au-shelf-title", "Other works" }
                        span { class: "au-shelf-meta", "{books_meta(&standalone, states)}" }
                    }
                    {book_grid(standalone, states, server_url, |_| None)}
                }
            }
        }
    }
}
