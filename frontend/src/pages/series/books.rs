//! The series' books in reading order, under a heading with how many the
//! reader finished and which numbers the library is missing; each cover is
//! captioned with its number and year and carries the reader's bar.

use std::collections::BTreeSet;

use dioxus::prelude::*;
use omnibus_shared::EbookMetadata;

use crate::pages::browse::{book_grid, books_meta, BookStates};

/// Highest number [`missing_numbers`] looks for gaps below; a series numbered
/// by year or issue past it isn't a run a reader collects book by book.
const MAX_GAP_SCAN: u32 = 200;

/// Every book in reading order, or a note when the library holds none.
/// `total` is the series' whole count, which a capped list falls short of.
pub fn series_books(
    books: Vec<EbookMetadata>,
    states: &BookStates,
    server_url: &str,
    total: usize,
) -> Element {
    // A series can outlive its last member — clearing a book's series by
    // override drops the membership but not the row — so say so rather than
    // rendering a titled void.
    if books.is_empty() {
        return rsx! {
            p { class: "subtitle se-empty", "data-testid": "series-empty",
                "No books in this series are in your library."
            }
        };
    }
    rsx! {
        section { class: "au-shelf",
            {reading_order_head(&books, states, total)}
            {book_grid(books, states, server_url, tile_caption)}
        }
    }
}

/// The heading over the books: how many and how many finished — or, past the
/// book cap, how many of the series loaded — and the numbers missing.
pub fn reading_order_head(books: &[EbookMetadata], states: &BookStates, total: usize) -> Element {
    let count = if total > books.len() {
        format!("First {} of {total} books", books.len())
    } else {
        books_meta(books, states)
    };
    let gaps = missing_label(&missing_numbers(books));
    rsx! {
        header { class: "au-shelf-head",
            h3 { class: "au-shelf-title", "Reading order" }
            span { class: "au-shelf-meta", "{count}" }
            if let Some(gaps) = gaps {
                span { class: "au-shelf-meta se-gaps", "data-testid": "series-gaps", "{gaps}" }
            }
        }
    }
}

/// A cover's caption: "Book 1 · 2016", dropping either half when it's absent.
/// Only a real year counts: a sentinel date drops the whole slot rather than
/// trailing a bare `·`, so two equally dateless books read the same.
pub fn tile_caption(book: &EbookMetadata) -> Option<String> {
    let number = book.series_index.as_deref().map(|i| format!("Book {i}"));
    let year = book
        .published
        .as_deref()
        .and_then(crate::format::format_year);
    match (number, year) {
        (Some(n), Some(y)) => Some(format!("{n} \u{b7} {y}")),
        (n, y) => n.or(y),
    }
}

/// The whole numbers from 1 to the highest whole series number held that no
/// book in the library carries. Fractional numbers (novellas at 2.5) neither
/// count as gaps nor fill one.
pub fn missing_numbers(books: &[EbookMetadata]) -> Vec<u32> {
    let held: BTreeSet<u32> = books
        .iter()
        .filter_map(|b| b.series_index.as_deref()?.trim().parse::<f64>().ok())
        .filter(|n| n.fract() == 0.0 && *n >= 1.0 && *n <= f64::from(MAX_GAP_SCAN))
        .map(|n| n as u32)
        .collect();
    let Some(&top) = held.last() else {
        return Vec::new();
    };
    (1..top).filter(|n| !held.contains(n)).collect()
}

/// "Not in your library: #4, #6–8", runs collapsed; `None` without a gap.
pub fn missing_label(missing: &[u32]) -> Option<String> {
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for &n in missing {
        match runs.last_mut() {
            Some((_, end)) if *end + 1 == n => *end = n,
            _ => runs.push((n, n)),
        }
    }
    if runs.is_empty() {
        return None;
    }
    let spans: Vec<String> = runs
        .iter()
        .map(|&(a, b)| {
            if a == b {
                format!("#{a}")
            } else {
                format!("#{a}\u{2013}{b}")
            }
        })
        .collect();
    Some(format!("Not in your library: {}", spans.join(", ")))
}
