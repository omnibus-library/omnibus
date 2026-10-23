//! Unit tests for the loaded-book view's pure label helpers.

use super::*;

#[test]
fn series_label_formats_name_and_index() {
    assert_eq!(
        series_label(Some("Dune"), Some("2")),
        Some("Dune #2".into())
    );
}

#[test]
fn series_label_without_index_is_just_name() {
    assert_eq!(series_label(Some("Dune"), None), Some("Dune".into()));
}

#[test]
fn series_label_absent_series_is_none() {
    assert_eq!(series_label(None, Some("2")), None);
    assert_eq!(series_label(None, None), None);
}

#[test]
fn settle_after_poll_cap_turns_a_still_pending_lookup_into_unavailable() {
    assert_eq!(
        settle_after_poll_cap(SuggestionsResponse::Pending),
        SuggestionsResponse::Unavailable
    );
}

#[test]
fn settle_after_poll_cap_leaves_every_settled_answer_alone() {
    for settled in [
        SuggestionsResponse::NotConfigured,
        SuggestionsResponse::Unavailable,
        SuggestionsResponse::Ready { items: Vec::new() },
    ] {
        assert_eq!(settle_after_poll_cap(settled.clone()), settled);
    }
}

fn credited_book(formats: &[&str], has_physical: bool) -> EbookMetadata {
    EbookMetadata {
        formats: formats.iter().map(|f| (*f).to_string()).collect(),
        has_physical,
        creators: vec![omnibus_shared::Contributor {
            name: "Ada Lovelace".into(),
            role: None,
            file_as: None,
            id: Some(3),
        }],
        ..Default::default()
    }
}

#[test]
fn derive_loaded_view_withholds_the_author_page_from_a_wishlist_only_book() {
    let wish_only = derive_loaded_view(&credited_book(&[], false));
    assert_eq!(wish_only.author_id, None);
    assert_eq!(wish_only.primary_author, "Ada Lovelace");
}

#[test]
fn derive_loaded_view_keeps_the_author_page_for_a_book_with_a_file_or_a_copy() {
    assert_eq!(
        derive_loaded_view(&credited_book(&["EPUB"], false)).author_id,
        Some(3)
    );
    assert_eq!(
        derive_loaded_view(&credited_book(&[], true)).author_id,
        Some(3)
    );
}
