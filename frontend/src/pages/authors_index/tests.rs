//! Render tests for `/authors`' preview pane: what it says while the list
//! loads, when it failed, and when the library is empty.

use super::*;
use crate::test_support::render_in_vdom;

/// Renders `/authors`' pane under a layout context previewing `preview`.
fn pane(preview: Preview) -> Element {
    let preview = use_memo(move || preview);
    let authors = use_signal(Vec::new);
    let reading = use_signal(|| ReadingState::Pending);
    use_context_provider(|| AuthorsListContext {
        preview,
        authors,
        reading,
    });
    rsx! { AuthorsIndexPage {} }
}

#[test]
fn preview_pane_says_the_list_failed_rather_than_that_the_library_is_empty() {
    let html = render_in_vdom(|| pane(Preview::Unavailable));
    assert!(html.contains("load authors"), "{html}");
    assert!(!html.contains("library is empty"), "{html}");
}

#[test]
fn preview_pane_says_the_library_is_empty_only_when_it_is() {
    let html = render_in_vdom(|| pane(Preview::Empty));
    assert!(html.contains("library is empty"), "{html}");
}

#[test]
fn preview_pane_loads_while_the_preview_is_pending() {
    let html = render_in_vdom(|| pane(Preview::Pending));
    assert!(html.contains("Gathering every author"), "{html}");
}
