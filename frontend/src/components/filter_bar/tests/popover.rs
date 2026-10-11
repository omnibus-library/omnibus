use super::*;

#[component]
fn PickerHarness() -> Element {
    rsx! {
        picker::FilterPicker {
            shelves: ShelfList::Pending,
            viewer_id: None,
            on_apply: move |_| {},
            on_close: move |_| {},
        }
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

fn ready(labels: &[&str]) -> picker::LoadState {
    picker::LoadState::Ready(list(
        labels
            .iter()
            .map(|label| option(label, label, Some(1)))
            .collect(),
    ))
}

fn ready_capped(labels: &[&str], cap: usize) -> picker::LoadState {
    let options = labels
        .iter()
        .map(|label| option(label, label, Some(1)))
        .collect();
    picker::LoadState::Ready(Rc::new(OptionList::new(options).with_cap(Some(cap))))
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

    assert_eq!(
        disabled_inputs(&html),
        1,
        "only the unpicked box locks: {html}"
    );
}

#[test]
fn state_for_reads_a_loading_state_until_the_chosen_field_has_answered() {
    let tags = Some((FilterField::Tag, Ok(list(vec![option("a", "a", None)]))));

    assert_eq!(
        picker::state_for(FilterField::Author, tags, &ShelfList::Pending, None),
        picker::LoadState::Loading
    );
    assert_eq!(
        picker::state_for(FilterField::Author, None, &ShelfList::Pending, None),
        picker::LoadState::Loading
    );
}

#[test]
fn state_for_returns_the_answer_for_the_chosen_field() {
    let options = list(vec![option("a", "a", None)]);

    assert_eq!(
        picker::state_for(
            FilterField::Tag,
            Some((FilterField::Tag, Ok(options.clone()))),
            &ShelfList::Pending,
            None
        ),
        picker::LoadState::Ready(options)
    );
    assert_eq!(
        picker::state_for(
            FilterField::Tag,
            Some((FilterField::Tag, Err("offline".to_string()))),
            &ShelfList::Pending,
            None
        ),
        picker::LoadState::Failed("offline".to_string())
    );
}

#[test]
fn state_for_reads_the_shelf_field_off_the_bars_loaded_list() {
    let shelves = ShelfList::Loaded(vec![
        shelf(4, "Favourites", ShelfKind::Manual, 3),
        shelf(5, "Unread sci-fi", ShelfKind::Smart, 9),
    ]);

    assert_eq!(
        picker::state_for(FilterField::Shelf, None, &shelves, Some(1)),
        picker::LoadState::Ready(list(vec![option("4", "Favourites", Some(3))]))
    );
}

#[test]
fn state_for_waits_on_its_own_fetch_while_the_bars_shelves_are_unknown() {
    for shelves in [ShelfList::Pending, ShelfList::Failed] {
        assert_eq!(
            picker::state_for(FilterField::Shelf, None, &shelves, Some(1)),
            picker::LoadState::Loading
        );
    }
}

#[test]
fn state_for_leaves_other_fields_alone_when_the_bars_shelves_are_loaded() {
    let shelves = ShelfList::Loaded(vec![shelf(4, "Favourites", ShelfKind::Manual, 3)]);

    assert_eq!(
        picker::state_for(FilterField::Tag, None, &shelves, Some(1)),
        picker::LoadState::Loading
    );
}

#[test]
fn needs_fetch_skips_the_shelf_field_once_the_bars_list_loaded() {
    let loaded = ShelfList::Loaded(vec![shelf(4, "Favourites", ShelfKind::Manual, 3)]);

    assert!(!picker::needs_fetch(FilterField::Shelf, &loaded));
}

#[test]
fn needs_fetch_asks_for_the_shelf_field_while_the_bars_list_is_unknown() {
    assert!(picker::needs_fetch(FilterField::Shelf, &ShelfList::Pending));
    assert!(picker::needs_fetch(FilterField::Shelf, &ShelfList::Failed));
}

#[test]
fn needs_fetch_asks_for_every_other_field_even_with_shelves_loaded() {
    let loaded = ShelfList::Loaded(vec![shelf(4, "Favourites", ShelfKind::Manual, 3)]);

    assert!(picker::needs_fetch(FilterField::Tag, &loaded));
}

#[test]
fn status_line_says_how_many_matched_when_the_row_cap_cut_the_list() {
    let line = picker::status_line("tags", 200, 205, None);

    assert_eq!(
        line.as_deref(),
        Some("Showing 200 of 205 \u{b7} search to narrow")
    );
}

#[test]
fn status_line_is_absent_when_every_match_is_shown() {
    assert_eq!(picker::status_line("tags", 5, 5, None), None);
}

#[test]
fn status_line_says_the_list_holds_only_the_most_used_values_when_the_source_was_cut() {
    let line = picker::status_line("tags", 200, 500, Some(500));

    assert_eq!(
        line.as_deref(),
        Some("Showing 200 of the 500 most-used tags \u{b7} search narrows within them")
    );
}

#[test]
fn status_line_still_names_the_source_cap_when_every_match_is_shown() {
    let line = picker::status_line("genres", 3, 3, Some(500));

    assert_eq!(
        line.as_deref(),
        Some("Showing 3 of the 500 most-used genres \u{b7} search narrows within them")
    );
}

#[test]
fn no_match_line_names_the_query() {
    assert_eq!(
        picker::no_match_line("tags", " zzz ", None),
        "No tags match \u{201c}zzz\u{201d}."
    );
}

#[test]
fn no_match_line_says_the_search_covered_only_the_most_used_values() {
    assert_eq!(
        picker::no_match_line("tags", "zzz", Some(500)),
        "No tags match \u{201c}zzz\u{201d} among the 500 most-used."
    );
}

#[test]
fn picker_body_says_the_list_holds_only_the_most_used_when_the_source_was_cut() {
    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &[],
        ready_capped(&["Sci-Fi", "Cozy"], 500),
    );

    assert!(
        html.contains("data-testid=\"filter-picker-status\""),
        "{html}"
    );
    assert!(html.contains("the 500 most-used tags"), "{html}");
}

#[test]
fn picker_body_names_the_source_cap_when_a_search_finds_nothing() {
    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "zzz",
        &[],
        ready_capped(&["Sci-Fi"], 500),
    );

    assert!(html.contains("among the 500 most-used"), "{html}");
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
