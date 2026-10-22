//! Render tests for `/series`' preview pane — what it says while the list
//! loads, when it failed, and when the library is empty — and a row's
//! accessible name.

use omnibus_shared::{SeriesReading, SeriesSummary};

use super::*;
use crate::test_support::render_in_vdom;

/// Renders `/series`' pane under a layout context previewing `preview`.
fn pane(preview: Preview) -> Element {
    let preview = use_memo(move || preview);
    use_context_provider(|| SeriesListContext { preview });
    rsx! { SeriesIndexPage {} }
}

#[test]
fn preview_pane_says_the_list_failed_rather_than_that_the_library_is_empty() {
    let html = render_in_vdom(|| pane(Preview::Unavailable));
    assert!(html.contains("load series"), "{html}");
    assert!(!html.contains("library is empty"), "{html}");
}

#[test]
fn preview_pane_says_no_book_is_in_a_series_rather_than_that_the_library_is_empty() {
    let html = render_in_vdom(|| pane(Preview::Empty));
    assert!(
        html.contains("no book in the library belongs to one"),
        "{html}"
    );
    assert!(!html.contains("library is empty"), "{html}");
}

#[test]
fn preview_pane_loads_while_the_preview_is_pending() {
    let html = render_in_vdom(|| pane(Preview::Pending));
    assert!(html.contains("Gathering every series"), "{html}");
}

fn dune() -> SeriesSummary {
    SeriesSummary {
        id: 1,
        name: "Dune".into(),
        primary_author: Some("Frank Herbert".into()),
        book_count: 6,
        ..Default::default()
    }
}

#[test]
fn row_label_names_the_series_author_count_and_finished() {
    let read = SeriesReading {
        series_id: 1,
        finished: 2,
        reading: 1,
        last_read_at: None,
    };
    assert_eq!(
        row_label(&dune(), Some(&read)),
        "Dune, by Frank Herbert, 6 books, 2 finished"
    );
}

#[test]
fn row_label_leaves_out_an_unknown_author_and_none_finished() {
    let lone = SeriesSummary {
        primary_author: None,
        book_count: 1,
        ..dune()
    };
    assert_eq!(row_label(&lone, None), "Dune, 1 book");
}
