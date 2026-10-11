//! Tests for the landing shelf lens's list-level filtering: the empty-filter
//! passthrough, every clause applied, and a shelf clause ruling nothing out.
//! Per-field and per-mode matching is pinned in `omnibus_shared::view_filters`.

use super::*;
use omnibus_shared::{FilterClause, FilterField, FilterMode};

fn book(id: i64, subjects: &[&str], formats: &[&str]) -> EbookMetadata {
    EbookMetadata {
        id,
        subjects: subjects.iter().map(|s| (*s).to_string()).collect(),
        formats: formats.iter().map(|f| (*f).to_string()).collect(),
        ..Default::default()
    }
}

fn ids(books: &[EbookMetadata]) -> Vec<i64> {
    books.iter().map(|b| b.id).collect()
}

fn sample() -> Vec<EbookMetadata> {
    vec![
        book(1, &["Fantasy"], &["epub"]),
        book(2, &["Sci-Fi"], &["m4b"]),
        book(3, &["Fantasy", "Sci-Fi"], &["epub", "m4b"]),
    ]
}

fn filters_of(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters { clauses }
}

#[test]
fn apply_filters_returns_every_book_in_order_when_no_filter_is_set() {
    let out = apply_filters(&sample(), &ViewFilters::default());
    assert_eq!(ids(&out), vec![1, 2, 3]);
}

#[test]
fn apply_filters_applies_every_clause() {
    let filters = filters_of(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["Fantasy"]),
        FilterClause::new(FilterField::Format, FilterMode::Exclude, &["m4b"]),
    ]);
    let out = apply_filters(&sample(), &filters);
    assert_eq!(ids(&out), vec![1]);
}

#[test]
fn apply_filters_keeps_every_book_when_a_shelf_clause_cannot_be_decided() {
    let filters = filters_of(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["Fantasy"]),
        FilterClause::new(FilterField::Shelf, FilterMode::Include, &["7"]),
    ]);
    let out = apply_filters(&sample(), &filters);
    assert_eq!(ids(&out), vec![1, 2, 3]);
}
