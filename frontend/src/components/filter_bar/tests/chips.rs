use super::*;

const VIEWER: i64 = 1;

fn labelled(clause: FilterClause, shelves: &ShelfList) -> String {
    chip_label(&clause, shelves, Some(VIEWER))
}

fn other_readers_shelf(id: i64, name: &str, owner: &str) -> ShelfSummary {
    ShelfSummary {
        owner_user_id: VIEWER + 1,
        owner_username: owner.to_string(),
        ..shelf(id, name, ShelfKind::Manual, 2)
    }
}

#[test]
fn chip_label_reads_field_mode_and_every_value() {
    let label = labelled(
        clause(FilterField::Author, FilterMode::Include, &["Ada", "Grace"]),
        &ShelfList::Pending,
    );

    assert_eq!(label, "Author includes any of Ada, Grace");
}

#[test]
fn chip_label_says_excludes_for_an_exclude_clause() {
    let label = labelled(
        clause(FilterField::Genre, FilterMode::Exclude, &["Horror"]),
        &ShelfList::Pending,
    );

    assert_eq!(label, "Genre excludes any of Horror");
}

#[test]
fn chip_label_uppercases_format_values() {
    let label = labelled(
        clause(FilterField::Format, FilterMode::Include, &["epub", "m4b"]),
        &ShelfList::Pending,
    );

    assert_eq!(label, "Format includes any of EPUB, M4B");
}

#[test]
fn chip_label_names_a_shelf_by_its_name_not_its_id() {
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let label = labelled(
        clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        &shelves,
    );

    assert_eq!(label, "Shelf includes any of Favourites");
}

#[test]
fn chip_label_names_the_owner_of_another_readers_shelf() {
    let shelves = ShelfList::Loaded(vec![
        shelf(12, "Favourites", ShelfKind::Manual, 3),
        other_readers_shelf(13, "Favourites", "alice"),
    ]);

    let label = labelled(
        clause(FilterField::Shelf, FilterMode::Include, &["12", "13"]),
        &shelves,
    );

    assert_eq!(
        label,
        "Shelf includes any of Favourites, Favourites \u{b7} alice"
    );
}

#[test]
fn chip_label_calls_a_shelf_missing_from_a_loaded_list_unavailable() {
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let label = labelled(
        clause(FilterField::Shelf, FilterMode::Exclude, &["99", "12"]),
        &shelves,
    );

    assert_eq!(label, "Shelf excludes any of unavailable shelf, Favourites");
}

#[test]
fn chip_label_holds_a_placeholder_for_a_shelf_until_the_list_answers() {
    let label = labelled(
        clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        &ShelfList::Pending,
    );

    assert_eq!(label, "Shelf includes any of \u{2026}");
}

#[test]
fn chip_label_calls_a_shelf_unavailable_once_the_shelves_fetch_failed() {
    let label = labelled(
        clause(FilterField::Shelf, FilterMode::Include, &["12", "13"]),
        &ShelfList::Failed,
    );

    assert_eq!(
        label,
        "Shelf includes any of unavailable shelf, unavailable shelf"
    );
}

#[test]
fn chip_parts_set_each_pending_shelf_apart_from_the_text_around_it() {
    let parts = chip_parts(
        &clause(FilterField::Shelf, FilterMode::Include, &["12", "13"]),
        &ShelfList::Pending,
        Some(VIEWER),
    );

    assert_eq!(
        parts,
        vec![
            ChipPart::Text("Shelf includes any of ".to_string()),
            ChipPart::Pending,
            ChipPart::Text(", ".to_string()),
            ChipPart::Pending,
        ]
    );
}

#[test]
fn chip_parts_are_one_text_when_no_value_is_pending() {
    let parts = chip_parts(
        &clause(FilterField::Tag, FilterMode::Include, &["a", "b"]),
        &ShelfList::Pending,
        Some(VIEWER),
    );

    assert_eq!(
        parts,
        vec![ChipPart::Text("Tag includes any of a, b".to_string())]
    );
}

#[test]
fn shelf_list_is_pending_until_the_shelves_fetch_answers() {
    assert_eq!(
        ShelfList::from_fetch(false, false, Vec::new()),
        ShelfList::Pending
    );
}

#[test]
fn shelf_list_is_failed_when_the_fetch_answered_without_a_list() {
    assert_eq!(
        ShelfList::from_fetch(false, true, Vec::new()),
        ShelfList::Failed
    );
}

#[test]
fn shelf_list_holds_the_shelves_once_they_loaded() {
    let shelves = vec![shelf(12, "Favourites", ShelfKind::Manual, 3)];

    assert_eq!(
        ShelfList::from_fetch(true, true, shelves.clone()),
        ShelfList::Loaded(shelves)
    );
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
fn BarHarness(filters: ViewFilters, shelves: ShelfList) -> Element {
    rsx! {
        FilterBar { filters, shelves, viewer_id: Some(VIEWER), on_change: move |_| {} }
    }
}

fn render_bar(filters: ViewFilters, shelves: ShelfList) -> String {
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
    let html = render_bar(ViewFilters::default(), ShelfList::Pending);

    assert!(html.contains("data-testid=\"lib-filter-bar\""), "{html}");
    assert!(html.contains("data-testid=\"filter-add\""));
    assert!(!html.contains("filter-chip-0"));
    assert!(!html.contains("filter-clear-all"));
}

#[test]
fn filter_bar_renders_no_picker_until_it_is_opened() {
    let html = render_bar(one_clause(), ShelfList::Pending);

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

    let html = render_bar(filters, ShelfList::Pending);

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
    let html = render_bar(one_clause(), ShelfList::Pending);

    assert!(html.contains("data-testid=\"filter-clear-all\""), "{html}");
}

#[test]
fn filter_bar_names_a_shelf_chip_from_the_shelves_list() {
    let filters = ViewFilters {
        clauses: vec![clause(FilterField::Shelf, FilterMode::Include, &["12"])],
    };
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let html = render_bar(filters, shelves);

    assert!(html.contains("Shelf includes any of Favourites"), "{html}");
}

fn shelf_clause() -> ViewFilters {
    ViewFilters {
        clauses: vec![clause(FilterField::Shelf, FilterMode::Include, &["12"])],
    }
}

#[test]
fn filter_bar_draws_a_pending_shelf_name_as_a_sheen() {
    let html = render_bar(shelf_clause(), ShelfList::Pending);

    assert!(
        html.contains("<span class=\"ld-sheen\">\u{2026}</span>"),
        "{html}"
    );
}

#[test]
fn filter_bar_resolves_a_shelf_chip_once_the_shelves_fetch_failed() {
    let html = render_bar(shelf_clause(), ShelfList::Failed);

    assert!(
        html.contains("Shelf includes any of unavailable shelf"),
        "{html}"
    );
    assert!(!html.contains("ld-sheen"), "{html}");
}

#[test]
fn filter_bar_names_the_owner_on_a_shelf_chip_for_another_readers_shelf() {
    let shelves = ShelfList::Loaded(vec![other_readers_shelf(12, "Favourites", "alice")]);

    let html = render_bar(shelf_clause(), shelves);

    assert!(
        html.contains("Shelf includes any of Favourites \u{b7} alice"),
        "{html}"
    );
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
    let html = render_bar(clauses_up_to(MAX_FILTER_CLAUSES), ShelfList::Pending);

    assert!(
        button_tag(&html, "filter-add").contains("disabled"),
        "{html}"
    );
}
