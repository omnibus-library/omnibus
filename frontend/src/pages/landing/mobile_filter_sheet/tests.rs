//! Unit tests for the mobile sort & filter sheet: sort labels and defaults,
//! and the format-chip toggles over the include-format clause.

use super::*;

#[test]
fn default_dir_for_dates_is_desc_and_text_asc() {
    assert_eq!(default_dir_for(SortKey::NewestAdded), SortDir::Desc);
    assert_eq!(default_dir_for(SortKey::LastUpdated), SortDir::Desc);
    assert_eq!(default_dir_for(SortKey::RecentlyInteracted), SortDir::Desc);
    assert_eq!(default_dir_for(SortKey::Title), SortDir::Asc);
}

#[test]
fn sort_options_offer_recently_interacted() {
    assert!(SORT_ROWS
        .iter()
        .any(|(k, label)| *k == SortKey::RecentlyInteracted && *label == "Recently interacted"));
}

#[test]
fn dir_label_reads_naturally_per_axis() {
    assert_eq!(
        dir_label(SortKey::NewestAdded, SortDir::Desc),
        "Newest first \u{2193}"
    );
    assert_eq!(
        dir_label(SortKey::Title, SortDir::Asc),
        "A\u{2013}Z \u{2191}"
    );
    assert_eq!(
        dir_label(SortKey::Author, SortDir::Desc),
        "Z\u{2013}A \u{2193}"
    );
}

const AUDIO: [&str; 3] = ["m4b", "m4a", "mp3"];

fn include_format(values: &[&str]) -> FilterClause {
    FilterClause::new(FilterField::Format, FilterMode::Include, values)
}

fn filters_of(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters { clauses }
}

#[test]
fn toggle_formats_adds_and_removes_chip_groups() {
    let mut filters = ViewFilters::default();
    toggle_formats(&mut filters, &AUDIO);
    assert_eq!(filters.clauses, vec![include_format(&AUDIO)]);
    assert!(chip_on(&filters, &AUDIO));
    // Adding a second group joins the same include-format clause.
    toggle_formats(&mut filters, &["epub"]);
    assert!(chip_on(&filters, &["epub"]));
    assert_eq!(
        filters.clauses,
        vec![include_format(&["m4b", "m4a", "mp3", "epub"])]
    );
    // Toggling off removes only that group's values.
    toggle_formats(&mut filters, &AUDIO);
    assert_eq!(filters.clauses, vec![include_format(&["epub"])]);
}

#[test]
fn toggle_formats_drops_the_clause_when_its_last_value_is_removed() {
    let mut filters = filters_of(vec![include_format(&["epub"])]);
    toggle_formats(&mut filters, &["epub"]);
    assert_eq!(filters, ViewFilters::default());
}

#[test]
fn toggle_formats_leaves_clauses_it_does_not_own_alone() {
    let others = vec![
        FilterClause::new(FilterField::Format, FilterMode::Exclude, &["pdf"]),
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]),
    ];
    let mut filters = filters_of(others.clone());
    toggle_formats(&mut filters, &["epub"]);
    assert_eq!(filters.clauses[..2], others[..]);
    assert_eq!(filters.clauses[2], include_format(&["epub"]));
    toggle_formats(&mut filters, &["epub"]);
    assert_eq!(filters.clauses, others);
}

#[test]
fn chip_on_ignores_an_exclude_format_clause() {
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Format,
        FilterMode::Exclude,
        &["epub"],
    )]);
    assert!(!chip_on(&filters, &["epub"]));
}

#[test]
fn clear_formats_removes_the_include_format_clause_and_keeps_the_rest() {
    let tag = FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]);
    let mut filters = filters_of(vec![include_format(&["epub"]), tag.clone()]);
    clear_formats(&mut filters);
    assert_eq!(filters.clauses, vec![tag]);
}
