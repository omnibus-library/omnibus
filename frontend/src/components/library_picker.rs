//! Shared "pick books from the whole library" surface: the fetch-on-mount
//! hook, the substring filter, and the picker itself — a searchable card grid
//! where every book carries its title, author and format, and books the shelf
//! already holds are marked and unselectable. Used by the create-shelf modal's
//! hand-picked body and the shelf page's "Add books" modal.

use dioxus::prelude::*;
use omnibus_shared::EbookMetadata;

use crate::components::atrium::{fallback_title, Cover};
use crate::components::cover_tile::thumb_srcs;
use crate::contexts::{cover_bust_for, CoverCacheBust};
use crate::data;
use crate::focus_after_paint::focus_after_paint;

/// How many matches the grid draws at once. A library runs to thousands of
/// rows; past a screenful a reader narrows with the search box rather than
/// scrolling, and every extra card is DOM the modal pays for.
const RENDER_CAP: usize = 120;

/// Fetches the full library once on mount, for a picker's search/select UI.
/// `loading` starts true and flips once the fetch settles either way, so the
/// picker can say "loading" instead of "your library is empty".
pub fn use_library_fetch(
    server_url: String,
    mut library: Signal<Vec<EbookMetadata>>,
    mut loading: Signal<bool>,
) {
    use_effect(move || {
        let url = server_url.clone();
        spawn(async move {
            if let Ok(lib) = data::get_ebooks(&url).await {
                library.set(lib.books);
            }
            loading.set(false);
        });
    });
}

/// Library books whose title (or filename fallback) or any credited name
/// contains `query`, case-insensitively; an empty query matches everything.
pub fn filter_library<'a>(books: &'a [EbookMetadata], query: &str) -> Vec<&'a EbookMetadata> {
    let q = query.trim().to_lowercase();
    books
        .iter()
        .filter(|b| q.is_empty() || haystack(b).contains(&q))
        .collect()
}

/// What the filter matches on. Authors are in it because a reader typing
/// "austen" means the author, and a title-only filter answers "no books match".
fn haystack(book: &EbookMetadata) -> String {
    let mut hay = fallback_title(book.title.as_deref(), &book.filename).to_lowercase();
    for creator in &book.creators {
        hay.push(' ');
        hay.push_str(&creator.name.to_lowercase());
    }
    hay
}

/// Toggle a book `uuid` in the picker's selection (remove if present, else append).
pub fn toggle_picked(picked: &mut Signal<Vec<String>>, uuid: &str) {
    picked.with_mut(|v| *v = toggled(v, uuid));
}

/// `uuid` dropped when `list` already holds it, appended otherwise — the rule
/// [`toggle_picked`] applies, split out so it is testable without a Dioxus
/// runtime (`Signal::new` panics outside one).
fn toggled(list: &[String], uuid: &str) -> Vec<String> {
    let mut next: Vec<String> = list
        .iter()
        .filter(|x| x.as_str() != uuid)
        .cloned()
        .collect();
    if next.len() == list.len() {
        next.push(uuid.to_string());
    }
    next
}

/// The line above the grid: how much of the library is in view. The count of
/// what's picked belongs to the host modal's submit button, which is the one
/// place it's reported.
fn status_line(total: usize, matched: usize, shown: usize) -> String {
    let mut line = if matched == total {
        plural(total, "book", "books")
    } else {
        format!("{matched} of {}", plural(total, "book", "books"))
    };
    if shown < matched {
        line.push_str(&format!(" \u{b7} showing the first {shown}"));
    }
    line
}

fn plural(n: usize, one: &str, many: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {many}")
    }
}

/// The picker. `already` are the uuids the target shelf holds, drawn as
/// members rather than choices; `search_testid` names the search box for its
/// host modal; `autofocus` puts the caret in it when the modal opens.
#[component]
pub fn LibraryPicker(
    books: Vec<EbookMetadata>,
    server_url: String,
    picked: Signal<Vec<String>>,
    #[props(default)] already: Vec<String>,
    #[props(default)] loading: bool,
    search_testid: String,
    #[props(default)] autofocus: bool,
) -> Element {
    let mut query = use_signal(String::new);
    let bust = use_context::<CoverCacheBust>();
    let text = query();
    let matches = filter_library(&books, &text);
    let total = books.len();
    let matched = matches.len();
    let shown: Vec<&EbookMetadata> = matches.into_iter().take(RENDER_CAP).collect();
    let picked_now = picked.read().clone();
    let ctx = CardCtx {
        server_url,
        already,
        picked_now,
        picked,
        bust,
    };

    rsx! {
        div { class: "pick",
            div { class: "pick-search-row",
                div { class: "pick-search",
                    {search_icon()}
                    input {
                        r#type: "search",
                        placeholder: "Search by title or author\u{2026}",
                        "aria-label": "Search your library",
                        "data-testid": "{search_testid}",
                        value: "{text}",
                        oninput: move |e| query.set(e.value()),
                        onmounted: move |evt: MountedEvent| {
                            if autofocus {
                                focus_after_paint(&evt);
                            }
                        },
                    }
                    if !text.is_empty() {
                        button {
                            r#type: "button",
                            class: "pick-search-clear",
                            "aria-label": "Clear search",
                            "data-testid": "picker-clear-search",
                            onclick: move |_| query.set(String::new()),
                            {x_icon()}
                        }
                    }
                }
                p { class: "pick-status", role: "status", "data-testid": "picker-status",
                    "{status_line(total, matched, shown.len())}"
                }
            }
            div { class: "pick-body",
                {body(&shown, total, &text, loading, &ctx)}
            }
        }
    }
}

/// Everything a card needs beyond its book. Bundled so [`card`] stays inside
/// clippy's argument cap.
struct CardCtx {
    server_url: String,
    already: Vec<String>,
    picked_now: Vec<String>,
    picked: Signal<Vec<String>>,
    bust: CoverCacheBust,
}

/// The grid, or the state that says why there isn't one.
fn body(
    shown: &[&EbookMetadata],
    total: usize,
    query: &str,
    loading: bool,
    ctx: &CardCtx,
) -> Element {
    if loading {
        return rsx! {
            p { class: "pick-state", "data-testid": "picker-loading",
                "Loading your library\u{2026}"
            }
        };
    }
    if total == 0 {
        return rsx! {
            p { class: "pick-state", "data-testid": "picker-empty",
                "No books in your library yet."
            }
        };
    }
    if shown.is_empty() {
        let q = query.trim().to_string();
        return rsx! {
            p { class: "pick-state", "data-testid": "picker-empty",
                "No books match \u{201c}{q}\u{201d}."
            }
        };
    }
    rsx! {
        div { class: "pick-grid",
            for book in shown.iter() {
                {card(book, ctx)}
            }
        }
    }
}

/// One book as a pickable card: cover, title, author, format — and, when the
/// shelf already holds it, a note saying so in place of the check.
fn card(book: &EbookMetadata, ctx: &CardCtx) -> Element {
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let title = fallback_title(book.title.as_deref(), &book.filename);
    let author = book
        .creators
        .first()
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let format = book.formats.first().cloned().unwrap_or_default();
    let on_shelf = ctx.already.contains(&uuid);
    let selected = ctx.picked_now.contains(&uuid);
    let (src, srcset) = thumb_srcs(
        book,
        &uuid,
        &ctx.server_url,
        cover_bust_for(ctx.bust.0, &uuid),
    );
    let mut picked = ctx.picked;
    let pick_uuid = uuid.clone();
    rsx! {
        button {
            key: "{book.id}",
            r#type: "button",
            class: "pick-card",
            "data-testid": "picker-tile-{uuid}",
            "aria-pressed": if selected { "true" } else { "false" },
            "aria-disabled": if on_shelf { "true" } else { "false" },
            onclick: move |_| {
                if !on_shelf {
                    toggle_picked(&mut picked, &pick_uuid);
                }
            },
            span { class: "pick-cover",
                Cover {
                    book: book.clone(),
                    src_override: src,
                    srcset,
                    sizes: Some("44px".to_string()),
                }
            }
            span { class: "pick-meta",
                span { class: "pick-name", "{title}" }
                if !author.is_empty() {
                    span { class: "pick-author", "{author}" }
                }
                span { class: "pick-tags",
                    if on_shelf {
                        span { class: "pick-on-shelf", "On this shelf" }
                    } else if !format.is_empty() {
                        span { class: "pick-tag", "{format}" }
                    }
                }
            }
            span { class: "pick-check", aria_hidden: true,
                if selected {
                    {check_icon()}
                }
            }
        }
    }
}

fn search_icon() -> Element {
    rsx! {
        svg {
            width: "14", height: "14", view_box: "0 0 24 24",
            fill: "none", stroke: "currentColor", stroke_width: "2",
            stroke_linecap: "round", stroke_linejoin: "round",
            circle { cx: "11", cy: "11", r: "8" }
            line { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }
        }
    }
}

fn x_icon() -> Element {
    rsx! {
        svg {
            width: "12", height: "12", view_box: "0 0 24 24",
            fill: "none", stroke: "currentColor", stroke_width: "2.2",
            stroke_linecap: "round", stroke_linejoin: "round",
            path { d: "M18 6 6 18M6 6l12 12" }
        }
    }
}

fn check_icon() -> Element {
    rsx! {
        svg {
            width: "12", height: "12", view_box: "0 0 24 24",
            fill: "none", stroke: "currentColor", stroke_width: "3",
            stroke_linecap: "round", stroke_linejoin: "round",
            path { d: "M20 6 9 17l-5-5" }
        }
    }
}

#[cfg(test)]
mod tests {
    use omnibus_shared::Contributor;

    use super::*;

    fn book(title: Option<&str>, filename: &str) -> EbookMetadata {
        EbookMetadata {
            title: title.map(str::to_string),
            filename: filename.to_string(),
            ..Default::default()
        }
    }

    fn by(title: &str, author: &str) -> EbookMetadata {
        EbookMetadata {
            creators: vec![Contributor {
                name: author.to_string(),
                ..Default::default()
            }],
            ..book(Some(title), "x.epub")
        }
    }

    #[test]
    fn filter_library_matches_title_case_insensitively() {
        let books = vec![book(Some("The Great Gatsby"), "gatsby.epub")];
        assert_eq!(filter_library(&books, "great").len(), 1);
        assert_eq!(filter_library(&books, "GATSBY").len(), 1);
        assert_eq!(filter_library(&books, "moby").len(), 0);
    }

    #[test]
    fn filter_library_falls_back_to_filename_when_title_is_missing() {
        let books = vec![book(None, "untitled-scan.epub")];
        assert_eq!(filter_library(&books, "untitled").len(), 1);
    }

    #[test]
    fn filter_library_matches_an_author() {
        // The reader types a name, not a title — the title-only filter used to
        // answer "no books match".
        let books = vec![
            by("Persuasion", "Jane Austen"),
            by("Dracula", "Bram Stoker"),
        ];
        let found = filter_library(&books, "austen");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title.as_deref(), Some("Persuasion"));
    }

    #[test]
    fn filter_library_ignores_surrounding_whitespace() {
        let books = vec![book(Some("Dracula"), "d.epub")];
        assert_eq!(filter_library(&books, "  dracula ").len(), 1);
    }

    #[test]
    fn filter_library_returns_every_book_when_query_is_empty() {
        let books = vec![book(Some("A"), "a.epub"), book(Some("B"), "b.epub")];
        assert_eq!(filter_library(&books, "").len(), 2);
        assert_eq!(filter_library(&books, "   ").len(), 2);
    }

    #[test]
    fn toggled_appends_a_new_pick_and_drops_an_existing_one() {
        let picked = toggled(&[], "a");
        assert_eq!(picked, vec!["a".to_string()]);
        let picked = toggled(&picked, "b");
        assert_eq!(picked, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(toggled(&picked, "a"), vec!["b".to_string()]);
    }

    #[test]
    fn status_line_counts_the_whole_library_and_says_when_it_truncated() {
        assert_eq!(
            status_line(127, 127, 120),
            "127 books \u{b7} showing the first 120"
        );
        assert_eq!(status_line(1, 1, 1), "1 book");
    }

    #[test]
    fn status_line_reports_how_many_matched() {
        assert_eq!(status_line(127, 12, 12), "12 of 127 books");
    }
}
