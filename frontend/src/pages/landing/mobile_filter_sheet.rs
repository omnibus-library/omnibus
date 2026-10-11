//! Mobile "Sort & filter" bottom sheet for the library home screen.
//!
//! Writes straight into the shared [`ViewPrefs`] (each tap fires
//! `on_change`, which persists + refetches page 1 server-side), so the
//! footer's "Show N books" is just a close affordance over live results.

use dioxus::prelude::*;
use omnibus_shared::{
    FilterClause, FilterField, FilterMode, SortDir, SortKey, ViewFilters, ViewPrefs,
};

/// Sort axes offered on mobile, in sheet order, with their row labels.
const SORT_ROWS: &[(SortKey, &str)] = &[
    (SortKey::RecentlyInteracted, "Recently interacted"),
    (SortKey::NewestAdded, "Recently added"),
    (SortKey::LastUpdated, "Recently updated"),
    (SortKey::Title, "Title"),
    (SortKey::Author, "Author"),
    (SortKey::Series, "Series"),
];

/// Format chips: display label → the lowercase values of the include-format
/// clause the chip toggles. "Audiobook" covers every direct-play audio container.
const FORMAT_CHIPS: &[(&str, &[&str])] =
    &[("EPUB", &["epub"]), ("Audiobook", &["m4b", "m4a", "mp3"])];

/// Short label for the header's sort pill.
pub(super) fn sort_pill_label(key: SortKey) -> &'static str {
    match key {
        SortKey::RecentlyInteracted => "Interacted",
        SortKey::NewestAdded => "Added",
        SortKey::LastUpdated => "Updated",
        SortKey::Title => "Title",
        SortKey::Author => "Author",
        SortKey::Series => "Series",
    }
}

/// Direction arrow for the header's sort pill.
pub(super) fn dir_arrow(dir: SortDir) -> &'static str {
    match dir {
        SortDir::Asc => "\u{2191}",
        SortDir::Desc => "\u{2193}",
    }
}

/// The direction the grid should default to when switching onto `key`:
/// newest-first for the date axes, ascending otherwise.
fn default_dir_for(key: SortKey) -> SortDir {
    match key {
        SortKey::NewestAdded | SortKey::LastUpdated | SortKey::RecentlyInteracted => SortDir::Desc,
        _ => SortDir::Asc,
    }
}

/// Human direction label shown on the selected sort row.
fn dir_label(key: SortKey, dir: SortDir) -> String {
    let text = match (key, dir) {
        (
            SortKey::NewestAdded | SortKey::LastUpdated | SortKey::RecentlyInteracted,
            SortDir::Desc,
        ) => "Newest first",
        (
            SortKey::NewestAdded | SortKey::LastUpdated | SortKey::RecentlyInteracted,
            SortDir::Asc,
        ) => "Oldest first",
        (_, SortDir::Asc) => "A\u{2013}Z",
        (_, SortDir::Desc) => "Z\u{2013}A",
    };
    format!("{text} {}", dir_arrow(dir))
}

fn is_include_format(clause: &FilterClause) -> bool {
    clause.field == FilterField::Format && clause.mode == FilterMode::Include
}

/// Whether a format chip is active (its first wire value is in an include-format clause).
fn chip_on(filters: &ViewFilters, values: &[&str]) -> bool {
    values.first().is_some_and(|v| {
        filters
            .clauses
            .iter()
            .filter(|c| is_include_format(c))
            .any(|c| c.values.iter().any(|f| f == v))
    })
}

/// Toggle a chip's format values in/out of the include-format clause, dropping
/// the clause once it has no value left.
fn toggle_formats(filters: &mut ViewFilters, values: &[&str]) {
    if chip_on(filters, values) {
        for clause in filters.clauses.iter_mut().filter(|c| is_include_format(c)) {
            clause.values.retain(|f| !values.contains(&f.as_str()));
        }
        filters
            .clauses
            .retain(|c| !(is_include_format(c) && c.values.is_empty()));
    } else if let Some(clause) = filters.clauses.iter_mut().find(|c| is_include_format(c)) {
        for v in values {
            if !clause.values.iter().any(|f| f == v) {
                clause.values.push((*v).to_string());
            }
        }
    } else {
        filters.clauses.push(FilterClause::new(
            FilterField::Format,
            FilterMode::Include,
            values,
        ));
    }
}

/// Drop every include-format clause, leaving the other clauses be.
fn clear_formats(filters: &mut ViewFilters) {
    filters.clauses.retain(|c| !is_include_format(c));
}

/// The bottom sheet. Fires `on_change` with a whole updated [`ViewPrefs`] on
/// every tap and `on_close` from the scrim / footer button.
#[component]
pub(super) fn MobileSortFilterSheet(
    prefs: ViewPrefs,
    book_count: Option<usize>,
    on_change: EventHandler<ViewPrefs>,
    on_close: EventHandler<MouseEvent>,
) -> Element {
    let show_label = match book_count {
        Some(1) => "Show 1 book".to_string(),
        Some(n) => format!("Show {n} books"),
        None => "Show books".to_string(),
    };
    let reset_prefs = prefs.clone();
    let on_reset = move |_| {
        let mut next = reset_prefs.clone();
        next.sort_key = SortKey::default();
        next.sort_dir = SortDir::default();
        next.filters = ViewFilters::default();
        on_change.call(next);
    };
    rsx! {
        div {
            class: "m-sheet-scrim",
            "data-testid": "mobile-sort-filter-sheet",
            onclick: move |e| on_close.call(e),
            div { class: "m-sheet", onclick: move |e| e.stop_propagation(),
                div { class: "m-sheet-grabber" }
                div { class: "m-sheet-head",
                    h4 { "Sort & filter" }
                    button {
                        r#type: "button", class: "m-sheet-reset",
                        "data-testid": "mobile-filter-reset",
                        onclick: on_reset,
                        "Reset"
                    }
                }
                div { class: "m-sheet-body",
                    div { class: "label m-filter-label", "Sort by" }
                    div { class: "m-sort-list",
                        for &(key, label) in SORT_ROWS {
                            {sort_row(key, label, &prefs, &on_change)}
                        }
                    }
                    div { class: "label m-filter-label", "Format" }
                    div { class: "m-filter-chips",
                        {all_chip(&prefs, &on_change)}
                        for &(label, values) in FORMAT_CHIPS {
                            {format_chip(label, values, &prefs, &on_change)}
                        }
                    }
                }
                div { class: "m-sheet-foot",
                    button {
                        r#type: "button", class: "btn primary m-sheet-show",
                        "data-testid": "mobile-filter-show",
                        onclick: move |e| on_close.call(e),
                        "{show_label}"
                    }
                }
            }
        }
    }
}

/// One sort row: tapping a new axis selects it with its default direction;
/// tapping the selected axis flips direction.
fn sort_row(
    key: SortKey,
    label: &'static str,
    prefs: &ViewPrefs,
    on_change: &EventHandler<ViewPrefs>,
) -> Element {
    let on = prefs.sort_key == key;
    let dir = dir_label(key, prefs.sort_dir);
    let next_base = prefs.clone();
    let handler = *on_change;
    rsx! {
        button {
            key: "{label}",
            r#type: "button",
            class: if on { "m-sort-row on" } else { "m-sort-row" },
            onclick: move |_| {
                let mut next = next_base.clone();
                if next.sort_key == key {
                    next.sort_dir = match next.sort_dir {
                        SortDir::Asc => SortDir::Desc,
                        SortDir::Desc => SortDir::Asc,
                    };
                } else {
                    next.sort_key = key;
                    next.sort_dir = default_dir_for(key);
                }
                handler.call(next);
            },
            span { class: "m-sort-row-label", "{label}" }
            if on {
                span { class: "m-sort-row-dir",
                    "{dir}"
                    svg {
                        width: "15", height: "15", view_box: "0 0 15 15", fill: "none",
                        stroke: "currentColor", stroke_width: "1.8",
                        stroke_linecap: "round", stroke_linejoin: "round",
                        path { d: "M3 8l3 3 6-7" }
                    }
                }
            }
        }
    }
}

/// The "All" chip — active when no format filter is set; tapping clears them.
fn all_chip(prefs: &ViewPrefs, on_change: &EventHandler<ViewPrefs>) -> Element {
    let on = !prefs.filters.clauses.iter().any(is_include_format);
    let next_base = prefs.clone();
    let handler = *on_change;
    rsx! {
        button {
            r#type: "button",
            class: if on { "m-filter-chip on" } else { "m-filter-chip" },
            onclick: move |_| {
                let mut next = next_base.clone();
                clear_formats(&mut next.filters);
                handler.call(next);
            },
            "All"
        }
    }
}

/// One format chip toggling its wire values.
fn format_chip(
    label: &'static str,
    values: &'static [&'static str],
    prefs: &ViewPrefs,
    on_change: &EventHandler<ViewPrefs>,
) -> Element {
    let on = chip_on(&prefs.filters, values);
    let next_base = prefs.clone();
    let handler = *on_change;
    rsx! {
        button {
            key: "{label}",
            r#type: "button",
            class: if on { "m-filter-chip on" } else { "m-filter-chip" },
            onclick: move |_| {
                let mut next = next_base.clone();
                toggle_formats(&mut next.filters, values);
                handler.call(next);
            },
            "{label}"
        }
    }
}

#[cfg(test)]
mod tests {
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
        assert!(
            SORT_ROWS
                .iter()
                .any(|(k, label)| *k == SortKey::RecentlyInteracted
                    && *label == "Recently interacted")
        );
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
}
