//! Mobile book page tests: which file rows it lists, and where its sections sit.

use super::*;

fn file(format: &str, ordinal: i64) -> BookFileInfo {
    BookFileInfo {
        id: ordinal,
        format: format.to_string(),
        filename: format!("part-{ordinal}.{}", format.to_lowercase()),
        ordinal,
        label: None,
        size_bytes: 0,
        path: None,
        etag: None,
        duration_seconds: None,
    }
}

#[test]
fn has_multi_file_format_is_false_for_an_empty_file_list() {
    assert!(!has_multi_file_format(&[]));
}

#[test]
fn has_multi_file_format_is_false_when_every_format_has_one_file() {
    assert!(!has_multi_file_format(&[file("EPUB", 0), file("M4B", 1)]));
}

#[test]
fn has_multi_file_format_is_true_when_a_format_has_two_files() {
    assert!(has_multi_file_format(&[file("M4B", 0), file("M4B", 1)]));
}

#[test]
fn has_multi_file_format_is_true_when_only_one_of_several_formats_has_duplicates() {
    assert!(has_multi_file_format(&[
        file("EPUB", 0),
        file("M4B", 1),
        file("M4B", 2),
    ]));
}

#[test]
fn has_multi_file_format_matches_formats_that_differ_only_by_ascii_case() {
    assert!(has_multi_file_format(&[file("M4B", 0), file("m4b", 1)]));
}

// Markup of the whole mobile page: needs `--features mobile,server` together,
// for `dioxus::ssr` alongside the mobile layout.
#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;

    use super::*;
    use crate::data::ServerUrl;
    use crate::pages::book_detail::DescriptionSignals;
    use crate::test_support::render_in_vdom;

    fn page() -> Element {
        use_context_provider(|| ServerUrl(Signal::new("http://library.test".to_string())));
        render_loaded_mobile(MobileBookView {
            b: EbookMetadata {
                unique_identifier: Some("book-1".into()),
                title: Some("Dracula".into()),
                ..Default::default()
            },
            author_books: None,
            suggestions: None,
            is_admin: false,
            server_url: "http://library.test".into(),
            description: DescriptionSignals {
                value: Signal::new(String::new()),
                epoch: Signal::new(0),
            },
        })
    }

    #[test]
    fn mobile_page_puts_reviews_where_the_rating_was_and_draws_their_loader_first() {
        let html = render_in_vdom(page);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("{needle}: {html}"))
        };

        assert!(at("Reading status") < at(REVIEWS_ANCHOR), "{html}");
        assert!(at(REVIEWS_ANCHOR) < at("Book info"), "{html}");
        assert!(html.contains("data-testid=\"reviews-loading\""), "{html}");
        assert!(html.contains("Counting reviews"), "{html}");
        assert!(!html.contains("Your rating"), "{html}");
        // No summary until the server sends one, so no household rating yet.
        assert!(!html.contains("reviews-jump"), "{html}");
    }
}
