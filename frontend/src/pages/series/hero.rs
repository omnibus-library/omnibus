//! The series pane's hero: a fan of its first covers where an author has a
//! portrait, the name, a line of how many books and by whom, and "Show in
//! library". Its own component so the navigator and filter hooks keep their
//! slots however the pane above it branches.

use dioxus::prelude::*;
use dioxus_router::{use_navigator, Link};
use omnibus_shared::{EbookMetadata, FilterClause, FilterField, FilterMode, ViewFilters};

use crate::components::atrium::Cover;
use crate::components::cover_tile::thumb_srcs;
use crate::Route;

/// Most covers the fan shows.
pub const STACK: usize = 3;
/// Most authors the meta line names before "and 2 more".
const NAMED_AUTHORS: usize = 2;

/// An author of the series, linked to their page when the library knows them.
#[derive(Debug, Clone, PartialEq)]
pub struct SeriesAuthor {
    pub name: String,
    pub id: Option<i64>,
}

/// Hero for one series: `stack` its first books in reading order, `authors`
/// from [`series_authors`].
#[component]
pub fn SeriesHero(
    name: String,
    stack: Vec<EbookMetadata>,
    authors: Vec<SeriesAuthor>,
    book_count: usize,
    server_url: String,
) -> Element {
    let nav = use_navigator();
    let mut handoff = crate::use_library_filter_handoff();
    let show_in_library = {
        let name = name.clone();
        move |_| {
            // Replaces the library's filter with this series alone.
            handoff.set(Some(ViewFilters {
                clauses: vec![FilterClause::new(
                    FilterField::Series,
                    FilterMode::Include,
                    &[name.as_str()],
                )],
            }));
            // A saved shelf pick outranks the library on the landing, and one
            // without this series would show nothing.
            crate::shelf_selection::save(crate::shelf_selection::ShelfSelection::All);
            nav.push(Route::Landing {});
        }
    };
    let more = authors.len().saturating_sub(NAMED_AUTHORS);
    rsx! {
        header { class: "au-hero",
            {cover_fan(&stack, &name, &server_url)}
            div { class: "au-hero-body",
                h2 { class: "au-name", "data-testid": "series-name", "{name}" }
                p { class: "au-meta", "data-testid": "series-meta",
                    "{books_label(book_count)}"
                    if !authors.is_empty() {
                        " \u{b7} by "
                    }
                    for (i, a) in authors.iter().take(NAMED_AUTHORS).enumerate() {
                        span { key: "{i}",
                            if i > 0 {
                                ", "
                            }
                            {author_name(a)}
                        }
                    }
                    if more > 0 {
                        " and {more} more"
                    }
                }
            }
            div { class: "au-hero-actions",
                button {
                    r#type: "button",
                    class: "au-btn",
                    "data-testid": "series-show-in-library",
                    onclick: show_in_library,
                    "Show in library"
                }
            }
        }
    }
}

/// "1 book" / "7 books".
pub fn books_label(count: usize) -> String {
    match count {
        1 => "1 book".to_string(),
        n => format!("{n} books"),
    }
}

/// Each book's first author, in reading order without repeats: the series'
/// author, or its authors when the books differ. A credited translator or
/// editor isn't who the series is by.
pub fn series_authors(books: &[EbookMetadata]) -> Vec<SeriesAuthor> {
    let mut out: Vec<SeriesAuthor> = Vec::new();
    for book in books {
        let first = book
            .creators
            .iter()
            .find(|c| c.role.as_deref().is_none_or(|r| r == "aut"));
        if let Some(c) = first.filter(|c| out.iter().all(|a| a.name != c.name)) {
            out.push(SeriesAuthor {
                name: c.name.clone(),
                id: c.id,
            });
        }
    }
    out
}

/// One author in the meta line: a link to their page, or plain text when the
/// library has no page for them.
fn author_name(a: &SeriesAuthor) -> Element {
    match a.id {
        Some(id) => rsx! {
            Link { to: Route::AuthorDetail { id }, class: "se-meta-link", "{a.name}" }
        },
        None => rsx! { "{a.name}" },
    }
}

/// The first covers fanned out, book one in front, where an author has a
/// portrait; the name's initial in its place for a series with no books.
fn cover_fan(books: &[EbookMetadata], name: &str, server_url: &str) -> Element {
    if books.is_empty() {
        let initial = name
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        return rsx! {
            div { class: "disc-avatar au-avatar", "aria-hidden": "true", "{initial}" }
        };
    }
    rsx! {
        div { class: "se-fan", "aria-hidden": "true",
            for book in books.iter() {
                {
                    let uuid = book.unique_identifier.clone().unwrap_or_default();
                    let (src, srcset) = thumb_srcs(book, &uuid, server_url, 0);
                    rsx! {
                        div { key: "{book.id}", class: "se-fan-cover",
                            Cover {
                                book: book.clone(),
                                src_override: src,
                                srcset,
                                sizes: Some("92px".to_string()),
                            }
                        }
                    }
                }
            }
        }
    }
}
