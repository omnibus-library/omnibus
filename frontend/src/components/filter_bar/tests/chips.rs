use super::*;

#[test]
fn chip_label_reads_field_mode_and_every_value() {
    let label = chip_label(
        &clause(FilterField::Author, FilterMode::Include, &["Ada", "Grace"]),
        None,
    );

    assert_eq!(label, "Author includes any of Ada, Grace");
}

#[test]
fn chip_label_says_excludes_for_an_exclude_clause() {
    let label = chip_label(
        &clause(FilterField::Genre, FilterMode::Exclude, &["Horror"]),
        None,
    );

    assert_eq!(label, "Genre excludes any of Horror");
}

#[test]
fn chip_label_uppercases_format_values() {
    let label = chip_label(
        &clause(FilterField::Format, FilterMode::Include, &["epub", "m4b"]),
        None,
    );

    assert_eq!(label, "Format includes any of EPUB, M4B");
}

#[test]
fn chip_label_names_a_shelf_by_its_name_not_its_id() {
    let shelves = vec![shelf(12, "Favourites", ShelfKind::Manual, 3)];

    let label = chip_label(
        &clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        Some(&shelves),
    );

    assert_eq!(label, "Shelf includes any of Favourites");
}

#[test]
fn chip_label_calls_a_shelf_missing_from_a_loaded_list_unavailable() {
    let shelves = vec![shelf(12, "Favourites", ShelfKind::Manual, 3)];

    let label = chip_label(
        &clause(FilterField::Shelf, FilterMode::Exclude, &["99", "12"]),
        Some(&shelves),
    );

    assert_eq!(label, "Shelf excludes any of unavailable shelf, Favourites");
}

#[test]
fn chip_label_holds_a_placeholder_for_a_shelf_until_the_list_loads() {
    let label = chip_label(
        &clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        None,
    );

    assert_eq!(label, "Shelf includes any of \u{2026}");
}

#[test]
fn with_clause_appends_after_the_existing_clauses() {
    let first = clause(FilterField::Tag, FilterMode::Include, &["a"]);
    let second = clause(FilterField::Format, FilterMode::Exclude, &["pdf"]);
    let filters = ViewFilters {
        clauses: vec![first.clone()],
    };

    let next = with_clause(&filters, second.clone());

    assert_eq!(next.clauses, vec![first, second]);
    assert_eq!(filters.clauses.len(), 1);
}

#[test]
fn without_clause_drops_only_the_clause_at_the_index() {
    let a = clause(FilterField::Tag, FilterMode::Include, &["a"]);
    let b = clause(FilterField::Series, FilterMode::Include, &["b"]);
    let c = clause(FilterField::Format, FilterMode::Exclude, &["c"]);
    let filters = ViewFilters {
        clauses: vec![a.clone(), b, c.clone()],
    };

    let next = without_clause(&filters, 1);

    assert_eq!(next.clauses, vec![a, c]);
}

#[test]
fn without_clause_leaves_the_filters_alone_for_an_out_of_range_index() {
    let filters = ViewFilters {
        clauses: vec![clause(FilterField::Tag, FilterMode::Include, &["a"])],
    };

    assert_eq!(without_clause(&filters, 1), filters);
}

// ---- the bar --------------------------------------------------------------

#[component]
fn BarHarness(filters: ViewFilters, shelves: Option<Vec<ShelfSummary>>) -> Element {
    rsx! {
        FilterBar { filters, shelves, on_change: move |_| {} }
    }
}

fn render_bar(filters: ViewFilters, shelves: Option<Vec<ShelfSummary>>) -> String {
    render(rsx! {
        BarHarness { filters, shelves }
    })
}

fn one_clause() -> ViewFilters {
    ViewFilters {
        clauses: vec![clause(FilterField::Author, FilterMode::Include, &["Ada"])],
    }
}

#[test]
fn filter_bar_renders_only_the_add_button_when_there_is_no_clause() {
    let html = render_bar(ViewFilters::default(), None);

    assert!(html.contains("data-testid=\"lib-filter-bar\""), "{html}");
    assert!(html.contains("data-testid=\"filter-add\""));
    assert!(!html.contains("filter-chip-0"));
    assert!(!html.contains("filter-clear-all"));
}

#[test]
fn filter_bar_renders_no_picker_until_it_is_opened() {
    let html = render_bar(one_clause(), None);

    assert!(html.contains("data-testid=\"filter-chip-0\""), "{html}");
    assert!(!html.contains("data-testid=\"filter-picker\""), "{html}");
}

#[test]
fn filter_bar_renders_a_labelled_chip_with_a_remove_button_per_clause() {
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            clause(FilterField::Genre, FilterMode::Exclude, &["Horror"]),
        ],
    };

    let html = render_bar(filters, None);

    assert!(html.contains("data-testid=\"filter-chip-0\""), "{html}");
    assert!(html.contains("Author includes any of Ada"));
    assert!(html.contains("data-testid=\"filter-chip-remove-0\""));
    assert!(html.contains("aria-label=\"Remove filter: Author includes any of Ada\""));
    assert!(html.contains("data-testid=\"filter-chip-1\""));
    assert!(html.contains("Genre excludes any of Horror"));
    assert!(!html.contains("filter-chip-2"));
}

#[test]
fn filter_bar_offers_clear_all_once_a_clause_exists() {
    let html = render_bar(one_clause(), None);

    assert!(html.contains("data-testid=\"filter-clear-all\""), "{html}");
}

#[test]
fn filter_bar_names_a_shelf_chip_from_the_shelves_list() {
    let filters = ViewFilters {
        clauses: vec![clause(FilterField::Shelf, FilterMode::Include, &["12"])],
    };
    let shelves = vec![shelf(12, "Favourites", ShelfKind::Manual, 3)];

    let html = render_bar(filters, Some(shelves));

    assert!(html.contains("Shelf includes any of Favourites"), "{html}");
}

fn clauses_up_to(count: usize) -> ViewFilters {
    ViewFilters {
        clauses: (0..count)
            .map(|i| clause(FilterField::Tag, FilterMode::Include, &[&format!("t{i}")]))
            .collect(),
    }
}

#[test]
fn filter_bar_disables_add_at_the_clause_cap() {
    let html = render_bar(clauses_up_to(MAX_FILTER_CLAUSES), None);

    assert!(
        button_tag(&html, "filter-add").contains("disabled"),
        "{html}"
    );
}
