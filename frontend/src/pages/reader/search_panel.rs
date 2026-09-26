//! In-book search panel. The query is run by the epub.js glue's `search`
//! method (spine walk + `section.find`), which posts matches back through
//! the `__omnibusOnSearchResults` callback registered in `interop`.

use dioxus::prelude::*;

use crate::components::Loading;

use super::drawer_shell::ReaderDrawerShell;

/// One search match from the glue.
#[derive(Clone, Default, PartialEq, serde::Deserialize)]
pub(crate) struct SearchResult {
    pub cfi: String,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub chapter: String,
}

#[component]
pub(super) fn SearchPanel(
    results: Signal<Vec<SearchResult>>,
    on_query: EventHandler<String>,
    on_navigate: EventHandler<String>,
    on_close: EventHandler<()>,
) -> Element {
    let mut query = use_signal(String::new);
    // Raised on Enter and lowered by the glue's answer; `answered` outlives it
    // so "No matches." is only ever said of a search that actually ran.
    let mut searching = use_signal(|| false);
    let mut answered = use_signal(|| false);
    use_effect(move || {
        let _ = results.read().len();
        if *searching.peek() {
            searching.set(false);
            answered.set(true);
        }
    });
    let hits = results.read().clone();
    let has_query = !query.read().trim().is_empty();
    let busy = searching();

    rsx! {
        ReaderDrawerShell {
            testid: "reader-search-drawer",
            // Lets the phone breakpoint take this one drawer full-screen
            // while the rest stay bottom sheets.
            extra_class: "rd-search-drawer",
            on_close,
            head: rsx! {
                h4 { class: "rd-drawer-title", "Search" }
            },
            div { class: "rd-search-box",
                input {
                    class: "rd-search-input",
                    r#type: "text",
                    "data-testid": "reader-search-input",
                    placeholder: "Search in book\u{2026} (Enter)",
                    autofocus: true,
                    value: "{query}",
                    oninput: move |e| query.set(e.value()),
                    onkeydown: move |e| {
                        if e.key() == Key::Enter {
                            searching.set(true);
                            on_query.call(query.peek().trim().to_string());
                        }
                    },
                }
            }
            if !busy && hits.len() == 1 {
                div { class: "rd-search-count", "1 match \u{b7} in this book" }
            } else if !busy && !hits.is_empty() {
                div { class: "rd-search-count", "{hits.len()} matches \u{b7} in this book" }
            }
            div { class: "rd-drawer-body",
                {search_body(&hits, busy, answered() && has_query, on_navigate)}
            }
        }
    }
}

/// The drawer body: a loader while the glue walks the book, the matches once
/// it answers, and an empty note that only claims "no matches" after a search.
fn search_body(
    hits: &[SearchResult],
    searching: bool,
    answered: bool,
    on_navigate: EventHandler<String>,
) -> Element {
    if searching {
        return rsx! {
            Loading { label: "Searching the book", testid: "reader-search-loading" }
        };
    }
    if hits.is_empty() {
        return rsx! {
            div { class: "rd-drawer-empty",
                if answered { "No matches." } else { "Type a query and press Enter." }
            }
        };
    }
    rsx! {
        for hit in hits.iter() {
            {
                let cfi = hit.cfi.clone();
                rsx! {
                    button {
                        key: "{hit.cfi}",
                        class: "rd-search-row",
                        r#type: "button",
                        "data-testid": "reader-search-row",
                        onclick: move |_| on_navigate.call(cfi.clone()),
                        if !hit.chapter.is_empty() {
                            span { class: "rd-search-chapter", "{hit.chapter}" }
                        }
                        span { class: "rd-search-excerpt", "{hit.excerpt}" }
                    }
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use crate::test_support::render;

    #[component]
    fn BodyHarness(hits: Vec<SearchResult>, searching: bool, answered: bool) -> Element {
        search_body(&hits, searching, answered, EventHandler::new(|_| {}))
    }

    #[test]
    fn search_body_shows_a_loader_rather_than_no_matches_while_searching() {
        let html =
            render(rsx! { BodyHarness { hits: Vec::new(), searching: true, answered: true } });
        assert!(
            html.contains("data-testid=\"reader-search-loading\""),
            "{html}"
        );
        assert!(!html.contains("No matches."), "{html}");
    }

    #[test]
    fn search_body_says_no_matches_only_once_a_search_has_answered_empty() {
        let html =
            render(rsx! { BodyHarness { hits: Vec::new(), searching: false, answered: true } });
        assert!(html.contains("No matches."), "{html}");
        let html =
            render(rsx! { BodyHarness { hits: Vec::new(), searching: false, answered: false } });
        assert!(html.contains("Type a query and press Enter."), "{html}");
    }

    #[test]
    fn search_body_lists_one_row_per_match() {
        let hits = vec![
            SearchResult {
                cfi: "a".into(),
                excerpt: "one".into(),
                chapter: String::new(),
            },
            SearchResult {
                cfi: "b".into(),
                excerpt: "two".into(),
                chapter: "II".into(),
            },
        ];
        let html = render(rsx! { BodyHarness { hits, searching: false, answered: true } });
        assert_eq!(
            html.matches("data-testid=\"reader-search-row\"").count(),
            2,
            "{html}"
        );
    }
}
