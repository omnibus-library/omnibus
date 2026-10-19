use super::*;

const VIEWER: i64 = 1;

/// The facet's value as text, a pending name reading as an ellipsis.
fn shown(clause: FilterClause, shelves: &ShelfList) -> String {
    facet_value(&clause, shelves, Some(VIEWER))
        .into_iter()
        .map(|part| match part {
            ValuePart::Text(text) => text,
            ValuePart::Pending => "\u{2026}".to_string(),
        })
        .collect()
}

fn other_readers_shelf(id: i64, name: &str, owner: &str) -> ShelfSummary {
    ShelfSummary {
        owner_user_id: VIEWER + 1,
        owner_username: owner.to_string(),
        ..shelf(id, name, ShelfKind::Manual, 2)
    }
}

#[test]
fn facet_value_names_the_first_value() {
    let value = shown(
        clause(FilterField::Author, FilterMode::Include, &["Ada"]),
        &ShelfList::Pending,
    );

    assert_eq!(value, "Ada");
}

#[test]
fn facet_value_counts_the_values_after_the_first() {
    let value = shown(
        clause(
            FilterField::Author,
            FilterMode::Include,
            &["Ada", "Grace", "Linus"],
        ),
        &ShelfList::Pending,
    );

    assert_eq!(value, "Ada +2");
}

#[test]
fn facet_value_says_not_ahead_of_an_exclude_clause() {
    let value = shown(
        clause(FilterField::Genre, FilterMode::Exclude, &["Horror"]),
        &ShelfList::Pending,
    );

    assert_eq!(value, "not Horror");
}

#[test]
fn facet_value_uppercases_format_values() {
    let value = shown(
        clause(FilterField::Format, FilterMode::Include, &["epub", "m4b"]),
        &ShelfList::Pending,
    );

    assert_eq!(value, "EPUB +1");
}

#[test]
fn facet_value_names_a_shelf_by_its_name_not_its_id() {
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let value = shown(
        clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        &shelves,
    );

    assert_eq!(value, "Favourites");
}

#[test]
fn facet_value_names_the_owner_of_another_readers_shelf() {
    let shelves = ShelfList::Loaded(vec![
        shelf(12, "Favourites", ShelfKind::Manual, 3),
        other_readers_shelf(13, "Favourites", "alice"),
    ]);

    let value = shown(
        clause(FilterField::Shelf, FilterMode::Include, &["13"]),
        &shelves,
    );

    assert_eq!(value, "Favourites \u{b7} alice");
}

#[test]
fn facet_value_calls_a_shelf_missing_from_a_loaded_list_unavailable() {
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let value = shown(
        clause(FilterField::Shelf, FilterMode::Exclude, &["99", "12"]),
        &shelves,
    );

    assert_eq!(value, "not unavailable shelf +1");
}

#[test]
fn facet_value_sets_a_pending_shelf_apart_until_the_list_answers() {
    let parts = facet_value(
        &clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        &ShelfList::Pending,
        Some(VIEWER),
    );

    assert_eq!(parts, vec![ValuePart::Pending]);
}

#[test]
fn facet_value_calls_a_shelf_unavailable_once_the_shelves_fetch_failed() {
    let value = shown(
        clause(FilterField::Shelf, FilterMode::Include, &["12"]),
        &ShelfList::Failed,
    );

    assert_eq!(value, "unavailable shelf");
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
fn with_field_clause_replaces_every_clause_on_its_field() {
    let tag = clause(FilterField::Tag, FilterMode::Include, &["a"]);
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            tag.clone(),
            clause(FilterField::Author, FilterMode::Exclude, &["Grace"]),
        ],
    };
    let linus = clause(FilterField::Author, FilterMode::Include, &["Linus"]);

    let next = with_field_clause(&filters, linus.clone());

    assert_eq!(next.clauses, vec![tag, linus]);
}

#[test]
fn with_field_clause_clears_the_field_for_a_clause_without_values() {
    let tag = clause(FilterField::Tag, FilterMode::Include, &["a"]);
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            tag.clone(),
        ],
    };

    let next = with_field_clause(
        &filters,
        clause(FilterField::Author, FilterMode::Include, &[]),
    );

    assert_eq!(next.clauses, vec![tag]);
}

#[test]
fn without_field_drops_only_that_fields_clauses() {
    let format = clause(FilterField::Format, FilterMode::Exclude, &["pdf"]);
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Series, FilterMode::Include, &["b"]),
            format.clone(),
            clause(FilterField::Series, FilterMode::Exclude, &["c"]),
        ],
    };

    assert_eq!(
        without_field(&filters, FilterField::Series).clauses,
        vec![format]
    );
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

fn shelf_clause() -> ViewFilters {
    ViewFilters {
        clauses: vec![clause(FilterField::Shelf, FilterMode::Include, &["12"])],
    }
}

#[test]
fn filter_bar_renders_a_facet_per_field_in_order() {
    let html = render_bar(ViewFilters::default(), ShelfList::Pending);

    assert!(html.contains("data-testid=\"lib-filter-bar\""), "{html}");
    let at: Vec<usize> = ["shelf", "tag", "genre", "author", "series", "format"]
        .iter()
        .map(|token| {
            html.find(&format!("data-testid=\"filter-facet-{token}\""))
                .unwrap_or_else(|| panic!("no filter-facet-{token} in {html}"))
        })
        .collect();
    assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "{html}");
    assert!(!html.contains("filter-facet-clear-"), "{html}");
    assert!(!html.contains("filter-clear-all"), "{html}");
}

#[test]
fn filter_bar_renders_no_picker_until_a_facet_is_opened() {
    let html = render_bar(one_clause(), ShelfList::Pending);

    assert!(!html.contains("data-testid=\"filter-picker\""), "{html}");
}

#[test]
fn filter_bar_names_an_active_facets_value_beside_its_own_clear() {
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            clause(FilterField::Genre, FilterMode::Exclude, &["Horror"]),
        ],
    };

    let html = render_bar(filters, ShelfList::Pending);

    assert!(html.contains(">Ada<"), "{html}");
    assert!(html.contains(">not Horror<"), "{html}");
    assert!(
        button_tag(&html, "filter-facet-clear-author")
            .contains("aria-label=\"Clear the Author filter\""),
        "{html}"
    );
    assert!(html.contains("filter-facet-clear-genre"), "{html}");
    assert!(!html.contains("filter-facet-clear-tag"), "{html}");
}

#[test]
fn filter_bar_shows_the_first_clause_when_a_field_holds_two() {
    let filters = ViewFilters {
        clauses: vec![
            clause(FilterField::Author, FilterMode::Include, &["Ada"]),
            clause(FilterField::Author, FilterMode::Include, &["Grace"]),
        ],
    };

    let html = render_bar(filters, ShelfList::Pending);

    assert!(html.contains(">Ada<"), "{html}");
    assert!(!html.contains("Grace"), "{html}");
}

#[test]
fn filter_bar_offers_clear_all_once_a_clause_exists() {
    let html = render_bar(one_clause(), ShelfList::Pending);

    assert!(html.contains("data-testid=\"filter-clear-all\""), "{html}");
}

#[test]
fn filter_bar_names_a_shelf_facet_from_the_shelves_list() {
    let shelves = ShelfList::Loaded(vec![shelf(12, "Favourites", ShelfKind::Manual, 3)]);

    let html = render_bar(shelf_clause(), shelves);

    assert!(html.contains(">Favourites<"), "{html}");
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
fn filter_bar_resolves_a_shelf_facet_once_the_shelves_fetch_failed() {
    let html = render_bar(shelf_clause(), ShelfList::Failed);

    assert!(html.contains(">unavailable shelf<"), "{html}");
    assert!(!html.contains("ld-sheen"), "{html}");
}

#[test]
fn filter_bar_names_the_owner_on_a_shelf_facet_for_another_readers_shelf() {
    let shelves = ShelfList::Loaded(vec![other_readers_shelf(12, "Favourites", "alice")]);

    let html = render_bar(shelf_clause(), shelves);

    assert!(html.contains(">Favourites \u{b7} alice<"), "{html}");
}
