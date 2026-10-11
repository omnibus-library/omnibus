//! Coverage for the filter bar: option mappers, chip text, clause edits, and
//! the markup the bar and its picker render.

use omnibus_shared::{
    AuthorSummary, FilterClause, FilterField, FilterMode, GenreWeight, SeriesSummary, ShelfKind,
    ShelfSummary, TagWeight, ViewFilters, Visibility, MAX_FILTER_CLAUSES, MAX_FILTER_VALUES,
};

use crate::test_support::render;

use super::values::*;
use super::*;

fn option(value: &str, label: &str, count: Option<usize>) -> FilterOption {
    FilterOption {
        value: value.to_string(),
        label: label.to_string(),
        count,
    }
}

fn tag(name: &str, count: usize) -> TagWeight {
    TagWeight {
        name: name.to_string(),
        count,
    }
}

fn author(name: &str, book_count: usize) -> AuthorSummary {
    AuthorSummary {
        id: 1,
        name: name.to_string(),
        book_count,
        ..Default::default()
    }
}

fn shelf(id: i64, name: &str, kind: ShelfKind, book_count: i64) -> ShelfSummary {
    ShelfSummary {
        id,
        owner_user_id: 1,
        owner_username: "reader".to_string(),
        owner_has_avatar: false,
        kind,
        name: name.to_string(),
        visibility: Visibility::Private,
        accent: None,
        book_count,
        cover_uuids: Vec::new(),
    }
}

// ---- value mappers -------------------------------------------------------

#[test]
fn tag_options_map_each_tag_to_a_counted_option() {
    let options = tag_options(vec![tag("Sci-Fi", 4), tag("Cozy", 2)]);

    assert_eq!(
        options,
        vec![
            option("Sci-Fi", "Sci-Fi", Some(4)),
            option("Cozy", "Cozy", Some(2))
        ]
    );
}

#[test]
fn genre_options_map_each_genre_to_a_counted_option() {
    let options = genre_options(vec![GenreWeight {
        name: "Fantasy".to_string(),
        count: 7,
    }]);

    assert_eq!(options, vec![option("Fantasy", "Fantasy", Some(7))]);
}

#[test]
fn series_options_map_each_series_to_a_counted_option() {
    let options = series_options(vec![SeriesSummary {
        id: 3,
        name: "Pioneers".to_string(),
        book_count: 5,
        ..Default::default()
    }]);

    assert_eq!(options, vec![option("Pioneers", "Pioneers", Some(5))]);
}

#[test]
fn author_options_merge_authors_sharing_a_name_ignoring_case() {
    let options = author_options(vec![
        author("Ann Leckie", 2),
        author("Ada Lovelace", 1),
        author("ann leckie", 3),
    ]);

    assert_eq!(
        options,
        vec![
            option("Ann Leckie", "Ann Leckie", Some(5)),
            option("Ada Lovelace", "Ada Lovelace", Some(1)),
        ]
    );
}

#[test]
fn shelf_options_offer_manual_and_wishlist_shelves_valued_by_id() {
    let options = shelf_options(vec![
        shelf(4, "Favourites", ShelfKind::Manual, 3),
        shelf(5, "Unread sci-fi", ShelfKind::Smart, 9),
        shelf(6, "Wishlist", ShelfKind::Wishlist, 1),
    ]);

    assert_eq!(
        options,
        vec![
            option("4", "Favourites", Some(3)),
            option("6", "Wishlist", Some(1)),
        ]
    );
}

#[test]
fn format_options_value_the_known_formats_lowercase_and_label_them_uppercase() {
    let options = format_options();

    assert_eq!(options.first(), Some(&option("epub", "EPUB", None)));
    assert_eq!(options.len(), omnibus_shared::KNOWN_LIBRARY_FORMATS.len());
}

#[test]
fn options_trim_the_value_they_filter_on() {
    let options = tag_options(vec![tag("  Sci-Fi ", 1)]);

    assert_eq!(options, vec![option("Sci-Fi", "Sci-Fi", Some(1))]);
}

#[test]
fn options_drop_blank_and_over_long_values_the_filter_would_reject() {
    let longest = "x".repeat(omnibus_shared::SHELF_RULE_VALUE_MAX_LEN);
    let too_long = "x".repeat(omnibus_shared::SHELF_RULE_VALUE_MAX_LEN + 1);

    let options = tag_options(vec![
        tag("", 1),
        tag("   ", 1),
        tag(&too_long, 1),
        tag(&longest, 1),
    ]);

    assert_eq!(options, vec![option(&longest, &longest, Some(1))]);
}

#[test]
fn matching_returns_every_option_for_a_blank_query() {
    let options = tag_options(vec![tag("Sci-Fi", 1), tag("Cozy", 1)]);

    let found = matching(&options, "  ", 10);

    assert_eq!(found.total, 2);
    assert_eq!(found.shown.len(), 2);
}

#[test]
fn matching_keeps_options_whose_label_contains_the_query_ignoring_case() {
    let options = tag_options(vec![
        tag("Sci-Fi", 1),
        tag("Cozy", 1),
        tag("Space Opera", 1),
    ]);

    let found = matching(&options, "SCI", 10);

    assert_eq!(found.shown, vec![&options[0]]);
    assert_eq!(found.total, 1);
}

#[test]
fn matching_caps_the_shown_options_but_reports_the_total() {
    let options = tag_options(vec![tag("a1", 1), tag("a2", 1), tag("a3", 1)]);

    let found = matching(&options, "a", 2);

    assert_eq!(found.shown, vec![&options[0], &options[1]]);
    assert_eq!(found.total, 3);
}

// ---- chip text and clause edits ------------------------------------------

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause::new(field, mode, values)
}

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

/// The opening `<button …>` tag that carries `testid`.
fn button_tag<'a>(html: &'a str, testid: &str) -> &'a str {
    let at = html
        .find(&format!("data-testid=\"{testid}\""))
        .unwrap_or_else(|| panic!("no {testid} in {html}"));
    let start = html[..at]
        .rfind("<button")
        .expect("a button opens before it");
    let end = at + html[at..].find('>').expect("the tag closes");
    &html[start..=end]
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
fn filter_bar_leaves_add_enabled_one_clause_below_the_cap() {
    let html = render_bar(clauses_up_to(MAX_FILTER_CLAUSES - 1), None);

    assert!(
        !button_tag(&html, "filter-add").contains("disabled"),
        "{html}"
    );
}

#[test]
fn filter_bar_disables_add_at_the_clause_cap() {
    let html = render_bar(clauses_up_to(MAX_FILTER_CLAUSES), None);

    assert!(
        button_tag(&html, "filter-add").contains("disabled"),
        "{html}"
    );
}

// ---- the picker ------------------------------------------------------------

#[component]
fn PickerHarness() -> Element {
    rsx! {
        picker::FilterPicker { on_apply: move |_| {}, on_close: move |_| {} }
    }
}

#[component]
fn BodyHarness(
    field: FilterField,
    mode: FilterMode,
    query: String,
    picked: Vec<String>,
    state: picker::LoadState,
) -> Element {
    rsx! {
        picker::PickerBody {
            field,
            mode,
            query,
            picked,
            state,
            on_mode: move |_| {},
            on_query: move |_| {},
            on_toggle: move |_| {},
            on_retry: move |_| {},
            on_apply: move |_| {},
            on_cancel: move |_| {},
        }
    }
}

fn render_body(
    field: FilterField,
    mode: FilterMode,
    query: &str,
    picked: &[&str],
    state: picker::LoadState,
) -> String {
    let query = query.to_string();
    let picked = picked.iter().map(|v| v.to_string()).collect();
    render(rsx! {
        BodyHarness { field, mode, query, picked, state }
    })
}

/// The `<input …>` tag of the checkbox named `label`.
fn checkbox_tag<'a>(html: &'a str, label: &str) -> &'a str {
    let at = html
        .find(&format!("aria-label=\"{label}\""))
        .unwrap_or_else(|| panic!("no checkbox named {label} in {html}"));
    let start = html[..at]
        .rfind("<input")
        .expect("an input opens before it");
    let end = at + html[at..].find('>').expect("the tag closes");
    &html[start..=end]
}

fn ready(labels: &[&str]) -> picker::LoadState {
    picker::LoadState::Ready(
        labels
            .iter()
            .map(|label| option(label, label, Some(1)))
            .collect(),
    )
}

#[test]
fn filter_picker_offers_the_six_fields_in_order_before_any_is_chosen() {
    let html = render(rsx! { PickerHarness {} });

    assert!(html.contains("data-testid=\"filter-picker\""), "{html}");
    let at: Vec<usize> = ["shelf", "tag", "genre", "author", "series", "format"]
        .iter()
        .map(|token| {
            html.find(&format!("data-testid=\"filter-field-{token}\""))
                .unwrap_or_else(|| panic!("no filter-field-{token} in {html}"))
        })
        .collect();
    assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "{html}");
    assert!(!html.contains("filter-mode-include"));
    assert!(!html.contains("filter-picker-search"));
    assert!(!html.contains("filter-picker-apply"));
}

#[test]
fn picker_body_presses_the_active_mode() {
    let html = render_body(
        FilterField::Tag,
        FilterMode::Exclude,
        "",
        &[],
        ready(&["Cozy"]),
    );

    assert!(button_tag(&html, "filter-mode-exclude").contains("aria-pressed=\"true\""));
    assert!(button_tag(&html, "filter-mode-include").contains("aria-pressed=\"false\""));
}

#[test]
fn picker_body_shows_a_loader_and_no_list_while_values_load() {
    let html = render_body(
        FilterField::Author,
        FilterMode::Include,
        "",
        &[],
        picker::LoadState::Loading,
    );

    assert!(
        html.contains("data-testid=\"filter-picker-loading\""),
        "{html}"
    );
    assert!(html.contains("Loading authors"));
    assert!(!html.contains("type=\"checkbox\""));
    assert!(!html.contains("filter-picker-empty"));
}

#[test]
fn picker_body_shows_an_alert_with_retry_when_values_fail_to_load() {
    let html = render_body(
        FilterField::Genre,
        FilterMode::Include,
        "",
        &[],
        picker::LoadState::Failed("offline".to_string()),
    );

    assert!(
        html.contains("data-testid=\"filter-picker-error\""),
        "{html}"
    );
    assert!(html.contains("role=\"alert\""));
    assert!(html.contains("Couldn\u{2019}t load genres"));
    assert!(html.contains("data-testid=\"filter-picker-retry\""));
    assert!(!html.contains("type=\"checkbox\""));
}

#[test]
fn picker_body_labels_each_value_checkbox_and_checks_the_picked_ones() {
    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &["Cozy"],
        ready(&["Sci-Fi", "Cozy"]),
    );

    assert_eq!(html.matches("type=\"checkbox\"").count(), 2, "{html}");
    assert!(!checkbox_tag(&html, "Sci-Fi").contains("checked"), "{html}");
    assert!(checkbox_tag(&html, "Cozy").contains("checked"), "{html}");
}

#[test]
fn picker_body_reports_when_nothing_matches_the_search() {
    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "zzz",
        &[],
        ready(&["Sci-Fi"]),
    );

    assert!(
        html.contains("data-testid=\"filter-picker-empty\""),
        "{html}"
    );
    assert!(html.contains("No tags match"));
    assert!(!html.contains("type=\"checkbox\""));
}

#[test]
fn picker_body_says_when_the_source_has_no_values_at_all() {
    let html = render_body(FilterField::Genre, FilterMode::Include, "", &[], ready(&[]));

    assert!(
        html.contains("data-testid=\"filter-picker-empty\""),
        "{html}"
    );
    assert!(html.contains("No genres yet"));
}

#[test]
fn picker_body_caps_the_rows_it_draws_and_says_how_many_matched() {
    let labels: Vec<String> = (0..picker::MAX_SHOWN_OPTIONS + 5)
        .map(|i| format!("tag-{i}"))
        .collect();
    let refs: Vec<&str> = labels.iter().map(String::as_str).collect();

    let html = render_body(FilterField::Tag, FilterMode::Include, "", &[], ready(&refs));

    assert_eq!(
        html.matches("type=\"checkbox\"").count(),
        picker::MAX_SHOWN_OPTIONS,
        "{html}"
    );
    assert!(html.contains("data-testid=\"filter-picker-status\""));
    assert!(html.contains(&format!("of {}", picker::MAX_SHOWN_OPTIONS + 5)));
}

#[test]
fn picker_body_disables_apply_until_a_value_is_picked() {
    let none = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &[],
        ready(&["a"]),
    );
    let one = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &["a"],
        ready(&["a"]),
    );

    assert!(button_tag(&none, "filter-picker-apply").contains("disabled"));
    assert!(!button_tag(&one, "filter-picker-apply").contains("disabled"));
    assert!(one.contains("Apply (1)"), "{one}");
}

#[test]
fn picker_body_disables_unpicked_boxes_once_the_value_cap_is_reached() {
    let picked: Vec<String> = (0..MAX_FILTER_VALUES).map(|i| format!("p{i}")).collect();
    let picked_refs: Vec<&str> = picked.iter().map(String::as_str).collect();
    let mut labels = picked_refs.clone();
    labels.push("extra");

    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &picked_refs,
        ready(&labels),
    );

    let boxes: Vec<&str> = html.split("<input").skip(1).collect();
    let disabled = boxes
        .iter()
        .filter(|tag| tag.split('>').next().unwrap().contains("disabled"))
        .count();
    assert_eq!(disabled, 1, "only the unpicked box locks: {html}");
}

#[test]
fn picker_body_keeps_unpicked_boxes_enabled_one_value_below_the_cap() {
    let picked: Vec<String> = (0..MAX_FILTER_VALUES - 1)
        .map(|i| format!("p{i}"))
        .collect();
    let picked_refs: Vec<&str> = picked.iter().map(String::as_str).collect();
    let mut labels = picked_refs.clone();
    labels.push("extra");

    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &picked_refs,
        ready(&labels),
    );

    assert!(
        !html.split("<input").skip(1).any(|tag| tag
            .split('>')
            .next()
            .unwrap()
            .contains("disabled")),
        "{html}"
    );
}

#[test]
fn state_for_reads_a_loading_state_until_the_chosen_field_has_answered() {
    let tags = Some((FilterField::Tag, Ok(vec![option("a", "a", None)])));

    assert_eq!(
        picker::state_for(FilterField::Author, tags),
        picker::LoadState::Loading
    );
    assert_eq!(
        picker::state_for(FilterField::Author, None),
        picker::LoadState::Loading
    );
}

#[test]
fn state_for_returns_the_answer_for_the_chosen_field() {
    let options = vec![option("a", "a", None)];

    assert_eq!(
        picker::state_for(
            FilterField::Tag,
            Some((FilterField::Tag, Ok(options.clone())))
        ),
        picker::LoadState::Ready(options)
    );
    assert_eq!(
        picker::state_for(
            FilterField::Tag,
            Some((FilterField::Tag, Err("offline".to_string())))
        ),
        picker::LoadState::Failed("offline".to_string())
    );
}

#[test]
fn toggle_pick_adds_a_value_then_removes_it_on_the_next_toggle() {
    let mut picked = Vec::new();

    picker::toggle_pick(&mut picked, "a");
    picker::toggle_pick(&mut picked, "b");
    picker::toggle_pick(&mut picked, "a");

    assert_eq!(picked, vec!["b".to_string()]);
}

#[test]
fn toggle_pick_refuses_a_new_value_past_the_value_cap_but_still_removes_one() {
    let mut picked: Vec<String> = (0..MAX_FILTER_VALUES).map(|i| format!("p{i}")).collect();

    picker::toggle_pick(&mut picked, "extra");
    assert_eq!(picked.len(), MAX_FILTER_VALUES);
    assert!(!picked.contains(&"extra".to_string()));

    picker::toggle_pick(&mut picked, "p0");
    assert_eq!(picked.len(), MAX_FILTER_VALUES - 1);
}
