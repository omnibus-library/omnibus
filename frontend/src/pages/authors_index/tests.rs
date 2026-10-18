//! Render tests for the authors list's three-valued states: a row's bar while
//! progress is pending, once it lands, and when it never will; the Reading
//! chip before its count is known; and `/authors`' preview pane branches.

use std::collections::HashMap;

use omnibus_shared::AuthorReading;

use super::*;
use crate::test_support::{render, render_in_vdom};

fn progress(finished: usize, reading: usize) -> AuthorReading {
    AuthorReading {
        author_id: 1,
        finished,
        reading,
        last_read_at: None,
    }
}

#[test]
fn row_bar_draws_a_skeleton_until_progress_lands() {
    let html = render(row_bar(4, None, &ReadingState::Pending));
    assert!(html.contains(r#"data-state="pending""#), "{html}");
    assert!(html.contains("ld-skel"), "{html}");
}

#[test]
fn row_bar_fills_finished_then_reading_by_share_of_books() {
    let html = render(row_bar(
        4,
        Some(&progress(1, 2)),
        &ReadingState::Ready(HashMap::new()),
    ));
    assert!(html.contains(r#"data-state="ready""#), "{html}");
    assert!(html.contains("width: 25%"), "finished share: {html}");
    assert!(html.contains("width: 50%"), "reading share: {html}");
}

#[test]
fn row_bar_marks_progress_unknown_rather_than_empty_when_it_fails() {
    let html = render(row_bar(4, None, &ReadingState::Failed));
    assert!(html.contains(r#"data-state="unknown""#), "{html}");
    assert!(html.contains("is-unknown"), "{html}");
}

#[allow(non_snake_case)]
fn HeadWithoutProgress() -> Element {
    rsx! {
        AuthorsListHead {
            total: Some(3),
            filter: String::new(),
            sort: AuthorSort::Name,
            reading_count: None,
            only_reading: false,
            on_filter: move |_| {},
            on_sort: move |_| {},
            on_only_reading: move |_| {},
        }
    }
}

#[allow(non_snake_case)]
fn HeadWithProgress() -> Element {
    rsx! {
        AuthorsListHead {
            total: Some(3),
            filter: String::new(),
            sort: AuthorSort::Name,
            reading_count: Some(2),
            only_reading: false,
            on_filter: move |_| {},
            on_sort: move |_| {},
            on_only_reading: move |_| {},
        }
    }
}

#[test]
fn reading_chip_is_inert_and_uncounted_until_progress_lands() {
    let html = render_in_vdom(HeadWithoutProgress);
    assert!(html.contains("disabled"), "{html}");
    assert!(html.contains("ld-sheen"), "{html}");
    assert!(!html.contains(r#"<span class="au-chip-count">0"#), "{html}");
}

#[test]
fn reading_chip_shows_its_count_once_progress_lands() {
    let html = render_in_vdom(HeadWithProgress);
    assert!(
        html.contains(r#"<span class="au-chip-count">2</span>"#),
        "{html}"
    );
    assert!(!html.contains("ld-sheen"), "{html}");
}

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
