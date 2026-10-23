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
