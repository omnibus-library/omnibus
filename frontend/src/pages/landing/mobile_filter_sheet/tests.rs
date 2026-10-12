//! Unit tests for the mobile sort & filter sheet: sort labels and defaults,
//! the format-chip toggles over the include-format clause, and the per-field
//! value picks and reset.

use omnibus_shared::ViewMode;

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

#[test]
fn clear_formats_removes_exclude_format_clauses_too() {
    let tag = FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]);
    let mut filters = filters_of(vec![
        FilterClause::new(FilterField::Format, FilterMode::Exclude, &["pdf"]),
        include_format(&["epub"]),
        tag.clone(),
    ]);
    clear_formats(&mut filters);
    assert_eq!(filters.clauses, vec![tag]);
}

#[test]
fn all_chip_on_is_off_while_an_exclude_format_clause_is_set() {
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Format,
        FilterMode::Exclude,
        &["pdf"],
    )]);
    assert!(!all_chip_on(&filters));
}

#[test]
fn all_chip_on_is_on_when_only_non_format_clauses_are_set() {
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Tag,
        FilterMode::Include,
        &["horror"],
    )]);
    assert!(all_chip_on(&filters));
}

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause::new(field, mode, values)
}

#[test]
fn toggle_value_adds_a_value_as_a_clause_of_that_field_and_mode() {
    let mut filters = ViewFilters::default();

    toggle_value(
        &mut filters,
        FilterField::Author,
        FilterMode::Exclude,
        "Ada",
    );

    assert_eq!(
        filters.clauses,
        vec![clause(FilterField::Author, FilterMode::Exclude, &["Ada"])]
    );
}

#[test]
fn toggle_value_joins_the_clause_already_holding_that_field_and_mode() {
    let mut filters = filters_of(vec![clause(FilterField::Tag, FilterMode::Include, &["a"])]);

    toggle_value(&mut filters, FilterField::Tag, FilterMode::Include, "b");

    assert_eq!(
        filters.clauses,
        vec![clause(FilterField::Tag, FilterMode::Include, &["a", "b"])]
    );
}

#[test]
fn toggle_value_removes_a_picked_value_and_drops_the_clause_it_empties() {
    let mut filters = filters_of(vec![
        clause(FilterField::Tag, FilterMode::Include, &["a", "b"]),
        clause(FilterField::Series, FilterMode::Include, &["s"]),
    ]);

    toggle_value(&mut filters, FilterField::Tag, FilterMode::Include, "a");
    assert_eq!(filters.clauses[0].values, vec!["b".to_string()]);

    toggle_value(&mut filters, FilterField::Tag, FilterMode::Include, "b");
    assert_eq!(
        filters.clauses,
        vec![clause(FilterField::Series, FilterMode::Include, &["s"])]
    );
}

#[test]
fn toggle_value_treats_a_value_differing_only_by_ascii_case_as_picked() {
    let mut filters = filters_of(vec![clause(
        FilterField::Tag,
        FilterMode::Include,
        &["Sci-Fi"],
    )]);

    toggle_value(
        &mut filters,
        FilterField::Tag,
        FilterMode::Include,
        "sci-fi",
    );

    assert_eq!(filters, ViewFilters::default());
}

#[test]
fn toggle_value_keeps_the_include_and_exclude_clauses_of_a_field_apart() {
    let mut filters = filters_of(vec![clause(
        FilterField::Author,
        FilterMode::Include,
        &["Ada"],
    )]);

    toggle_value(
        &mut filters,
        FilterField::Author,
        FilterMode::Exclude,
        "Ada",
    );

    assert_eq!(
        filters.clauses,
        vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            clause(FilterField::Author, FilterMode::Exclude, &["Ada"]),
        ]
    );
}

#[test]
fn picked_values_collects_a_field_and_mode_across_clauses() {
    let filters = filters_of(vec![
        clause(FilterField::Tag, FilterMode::Include, &["a"]),
        clause(FilterField::Tag, FilterMode::Exclude, &["x"]),
        clause(FilterField::Tag, FilterMode::Include, &["b"]),
    ]);

    assert_eq!(
        picked_values(&filters, FilterField::Tag, FilterMode::Include),
        vec!["a".to_string(), "b".to_string()]
    );
}

#[test]
fn reset_prefs_clears_the_sort_and_every_clause_in_one_step() {
    let prefs = ViewPrefs {
        sort_key: SortKey::Author,
        sort_dir: SortDir::Desc,
        view_mode: ViewMode::Table,
        filters: filters_of(vec![
            clause(FilterField::Shelf, FilterMode::Exclude, &["3"]),
            clause(FilterField::Tag, FilterMode::Include, &["a"]),
            include_format(&["epub"]),
        ]),
        ..ViewPrefs::default()
    };

    let reset = reset_prefs(&prefs);

    assert_eq!(reset.filters, ViewFilters::default());
    assert_eq!(reset.sort_key, SortKey::default());
    assert_eq!(reset.sort_dir, SortDir::default());
    assert_eq!(reset.view_mode, ViewMode::Table);
}
