//! Tests for the author pane's pure helpers: the meta lines and shelving
//! books by series.

use omnibus_shared::{EbookMetadata, ReadStatus};

use crate::pages::browse::test_support::{state, DAY};

use super::hero::hero_meta;
use super::progress::current_meta;
use super::shelf::{group_by_series, series_count};

fn book(uuid: &str, series: Option<(&str, &str)>) -> EbookMetadata {
    EbookMetadata {
        title: Some(uuid.to_uppercase()),
        unique_identifier: Some(uuid.into()),
        series: series.map(|(s, _)| s.into()),
        series_index: series.map(|(_, i)| i.into()),
        series_id: series.map(|_| 7),
        ..Default::default()
    }
}

#[test]
fn current_meta_names_series_percent_and_when() {
    let b = book("a", Some(("Earthsea", "2")));
    let (_, s) = state("a", ReadStatus::Reading, Some(42), Some(10 * DAY));
    assert_eq!(
        current_meta(&b, &s, 13 * DAY, Some(0)),
        "Earthsea 2 \u{b7} 42% \u{b7} read 3 days ago"
    );
}

#[test]
fn current_meta_drops_what_it_does_not_know() {
    let b = book("a", None);
    let (_, s) = state("a", ReadStatus::Reading, None, None);
    assert_eq!(current_meta(&b, &s, DAY, Some(0)), "");
}

#[test]
fn group_by_series_keeps_first_seen_order_and_sets_standalones_apart() {
    let books = vec![
        book("a", Some(("Earthsea", "1"))),
        book("b", Some(("Hainish", "1"))),
        book("c", None),
        book("d", Some(("Earthsea", "2"))),
    ];
    let (shelves, standalone) = group_by_series(books);
    let names: Vec<&str> = shelves.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Earthsea", "Hainish"]);
    assert_eq!(shelves[0].books.len(), 2);
    assert_eq!(standalone.len(), 1);
    assert_eq!(
        series_count(&[book("a", Some(("X", "1"))), book("b", Some(("X", "2")))]),
        1
    );
}

#[test]
fn hero_meta_leaves_out_a_zero_series_count() {
    assert_eq!(hero_meta(1, 0), "1 book");
    assert_eq!(hero_meta(11, 2), "11 books \u{b7} 2 series");
}
