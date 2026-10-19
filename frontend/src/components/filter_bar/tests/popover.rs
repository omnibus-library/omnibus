use super::*;

#[component]
fn PickerHarness(initial: FilterClause) -> Element {
    rsx! {
        picker::FilterPicker {
            shelves: ShelfList::Pending,
            viewer_id: None,
            initial,
            on_apply: move |_| {},
            on_close: move |_| {},
        }
    }
}

fn render_picker(initial: FilterClause) -> String {
    render(rsx! {
        PickerHarness { initial }
    })
}

#[component]
fn BodyHarness(
    field: FilterField,
    mode: FilterMode,
    query: String,
    picked: Vec<String>,
    state: picker::LoadState,
    #[props(default)] can_clear: bool,
) -> Element {
    rsx! {
        picker::PickerBody {
            field,
            mode,
            query,
            picked,
            state,
            can_clear,
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
fn filter_picker_opens_on_its_facets_field_and_mode() {
    let html = render_picker(clause(FilterField::Format, FilterMode::Exclude, &["epub"]));

    assert!(html.contains("aria-label=\"Filter by format\""), "{html}");
    assert!(
        button_tag(&html, "filter-mode-exclude").contains("aria-pressed=\"true\""),
        "{html}"
    );
    assert!(!html.contains("filter-field-"), "{html}");
}

#[test]
fn filter_picker_declares_itself_a_modal_dialog() {
    let html = render_picker(clause(FilterField::Tag, FilterMode::Include, &[]));

    assert!(html.contains("role=\"dialog\""), "{html}");
    assert!(html.contains("aria-modal=\"true\""), "{html}");
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
fn picker_body_checks_a_pick_that_differs_from_its_value_only_by_ascii_case() {
    // The engine matches names ignoring case, so a stored "sci-fi" is the "Sci-Fi" row.
    let html = render_body(
        FilterField::Tag,
        FilterMode::Include,
        "",
        &["sci-fi"],
        ready(&["Sci-Fi", "Cozy"]),
    );

    assert!(checkbox_tag(&html, "Sci-Fi").contains("checked"), "{html}");
    assert!(!checkbox_tag(&html, "Cozy").contains("checked"), "{html}");
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
fn picker_body_keeps_apply_live_with_nothing_picked_when_it_can_clear() {
    let html = render(rsx! {
        BodyHarness {
            field: FilterField::Tag,
            mode: FilterMode::Include,
            query: String::new(),
            picked: Vec::new(),
            state: ready(&["a"]),
            can_clear: true,
        }
    });

    assert!(
        !button_tag(&html, "filter-picker-apply").contains("disabled"),
        "{html}"
    );
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
fn state_for_labels_another_readers_shelf_with_the_viewer_that_is_current() {
    // The label is cut at render, so a viewer that resolves late relabels it.
    let mut theirs = shelf(4, "Favourites", ShelfKind::Manual, 3);
    theirs.owner_user_id = 2;
    let shelves = ShelfList::Loaded(vec![theirs]);

    assert_eq!(
        picker::state_for(FilterField::Shelf, None, &shelves, None),
        picker::LoadState::Ready(list(vec![option("4", "Favourites", Some(3))]))
    );
    assert_eq!(
        picker::state_for(FilterField::Shelf, None, &shelves, Some(1)),
        picker::LoadState::Ready(list(vec![option("4", "Favourites \u{b7} reader", Some(3))]))
    );
}

thread_local! {
    static COMMITS: std::cell::RefCell<(bool, bool, Vec<&'static str>)> =
        const { std::cell::RefCell::new((false, false, Vec::new())) };
}

#[test]
fn commit_if_current_drops_an_answer_a_newer_fetch_superseded() {
    // A panic inside a component is swallowed by the vdom, so the outcome
    // leaves it through a thread-local and is asserted out here.
    #[component]
    fn CommitBoth() -> Element {
        let epoch = Signal::new(2u32);
        let mut committed = Vec::new();

        let stale = picker::commit_if_current(epoch, 1, "stale", |answer| committed.push(answer));
        let fresh = picker::commit_if_current(epoch, 2, "fresh", |answer| committed.push(answer));

        COMMITS.with(|seen| *seen.borrow_mut() = (stale, fresh, committed));
        rsx! {}
    }
    VirtualDom::new(CommitBoth).rebuild_in_place();

    COMMITS.with(|seen| assert_eq!(*seen.borrow(), (false, true, vec!["fresh"])));
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
fn toggle_pick_unticks_a_saved_pick_that_differs_only_by_ascii_case() {
    let mut picked = vec!["Fantasy".to_string()];

    picker::toggle_pick(&mut picked, "fantasy");

    assert!(picked.is_empty(), "{picked:?}");
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

#[component]
fn FooterlessBodyHarness() -> Element {
    rsx! {
        picker::PickerBody {
            field: FilterField::Tag,
            mode: FilterMode::Include,
            query: String::new(),
            picked: vec!["a".to_string()],
            state: ready(&["a"]),
            footer: false,
            on_mode: move |_| {},
            on_query: move |_| {},
            on_toggle: move |_| {},
            on_retry: move |_| {},
        }
    }
}

#[test]
fn picker_body_leaves_out_cancel_and_apply_when_its_footer_is_off() {
    let html = render(rsx! { FooterlessBodyHarness {} });

    assert!(!html.contains("filter-picker-apply"), "{html}");
    assert!(!html.contains("filter-picker-cancel"), "{html}");
    assert!(
        html.contains("data-testid=\"filter-mode-include\""),
        "{html}"
    );
    assert!(html.contains("aria-label=\"a\""), "{html}");
}

fn offered_list(values: &[&str]) -> Rc<OptionList> {
    list(values.iter().map(|v| option(v, v, Some(1))).collect())
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_string()).collect()
}

#[test]
fn stranded_label_calls_a_shelf_the_list_lacks_unavailable() {
    assert_eq!(
        picker::stranded_label(FilterField::Shelf, "9"),
        "unavailable shelf"
    );
}

#[test]
fn stranded_label_uppercases_a_format_and_leaves_other_names_as_they_are() {
    assert_eq!(picker::stranded_label(FilterField::Format, "pdf"), "PDF");
    assert_eq!(picker::stranded_label(FilterField::Tag, "Sci-Fi"), "Sci-Fi");
}

#[test]
fn list_with_picks_keeps_the_same_list_when_every_pick_is_offered() {
    let list = offered_list(&["a", "b"]);

    let shown = list_with_picks(FilterField::Tag, list.clone(), &owned(&["a"]));

    assert!(Rc::ptr_eq(&list, &shown));
}

#[test]
fn list_with_picks_adds_a_pick_the_source_stopped_offering_first() {
    let list = offered_list(&["a"]);

    let shown = list_with_picks(FilterField::Shelf, list, &owned(&["9"]));

    let found = shown.matching("", 10);
    assert_eq!(found.shown[0].value, "9");
    assert_eq!(found.shown[0].label, "unavailable shelf");
    assert_eq!(found.total, 2);
}
